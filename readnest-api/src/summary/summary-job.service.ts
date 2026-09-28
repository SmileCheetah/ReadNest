import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, SummaryTaskState } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SUMMARY_ARTICLE_JOB, SUMMARY_QUEUE } from './summary.constants';
import { SummaryGenerationError } from './summary-errors';

export type SummaryJobData = {
  articleId: string;
  generation: number;
  taskId: string;
};
export const LEASE_MS = 90_000;
export const MAX_TASK_ATTEMPTS = 2;
export type TaskLease = {
  taskId: string;
  articleId: string;
  generation: number;
  token: string;
};

@Injectable()
export class SummaryJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SummaryJobService.name);
  private timer?: ReturnType<typeof setInterval>;
  private dispatching = false;
  private pendingEnqueue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SUMMARY_QUEUE) private readonly queue: Queue<SummaryJobData>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.dispatch();
    }, 5000);
    this.timer.unref();
    void this.dispatch();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // Persistent PENDING records are the outbox. Queue delivery may repeat; claim is CAS.
  async dispatch() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const now = new Date();
      const expired = await this.prisma.summaryTask.findMany({
        where: { state: 'RUNNING', leaseExpiresAt: { lte: now } },
        take: 50,
      });
      for (const task of expired) {
        await this.prisma.$transaction(async (tx) => {
          const terminal = task.attempts >= MAX_TASK_ATTEMPTS;
          const reclaimed = await tx.summaryTask.updateMany({
            where: {
              id: task.id,
              state: 'RUNNING',
              leaseExpiresAt: { lte: now },
            },
            data: {
              state: terminal ? 'FAILED' : 'PENDING',
              leaseToken: null,
              leaseExpiresAt: null,
              notBefore: now,
              ...(terminal ? { result: Prisma.DbNull } : {}),
            },
          });
          if (reclaimed.count)
            await tx.savedArticle.updateMany({
              where: { id: task.articleId, generation: task.generation },
              data: {
                stage: terminal ? 'FAILED' : 'QUEUED',
                processStatus: terminal ? 'SUMMARY_FAILED' : 'SUMMARIZING',
                errorCode: 'WORKER_INTERRUPTED',
                retryable: true,
                lastSummaryError:
                  '요약 작업이 중단되었습니다. 다시 시도할 수 있어요.',
              },
            });
        });
      }
      const tasks = await this.prisma.summaryTask.findMany({
        where: { state: 'PENDING', notBefore: { lte: now } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const task of tasks) {
        let pending = this.pendingEnqueue.get(task.id);
        if (!pending) {
          pending = this.queue
            .add(
              SUMMARY_ARTICLE_JOB,
              {
                articleId: task.articleId,
                generation: task.generation,
                taskId: task.id,
              },
              {
                jobId: task.id,
                attempts: 1,
                removeOnComplete: true,
                removeOnFail: true,
              },
            )
            .finally(() => {
              this.pendingEnqueue.delete(task.id);
            });
          this.pendingEnqueue.set(task.id, pending);
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('QUEUE_TIMEOUT')), 3000);
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
      }
    } catch {
      // Never discard the DB record when Redis is unavailable. Next poll recovers.
      this.logger.warn(
        'Summary dispatch unavailable; durable jobs remain queued.',
      );
    } finally {
      this.dispatching = false;
    }
  }

  async claim(data: SummaryJobData) {
    if (!data.taskId || !Number.isInteger(data.generation)) return null;
    const token = randomUUID();
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const article = await tx.savedArticle.findFirst({
        where: { id: data.articleId, generation: data.generation },
      });
      if (!article) {
        // A superseded generation is not deliverable. Retire its pending outbox
        // record so it cannot permanently occupy the oldest dispatch batch.
        await tx.summaryTask.updateMany({
          where: {
            id: data.taskId,
            articleId: data.articleId,
            generation: data.generation,
            state: 'PENDING',
          },
          data: { state: 'FAILED', result: Prisma.DbNull },
        });
        return null;
      }
      const claimed = await tx.summaryTask.updateMany({
        where: {
          id: data.taskId,
          articleId: data.articleId,
          generation: data.generation,
          state: 'PENDING',
          notBefore: { lte: now },
          attempts: { lt: MAX_TASK_ATTEMPTS },
        },
        data: {
          state: 'RUNNING',
          attempts: { increment: 1 },
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        },
      });
      if (!claimed.count) return null;
      const task = await tx.summaryTask.findUniqueOrThrow({
        where: { id: data.taskId },
      });
      return { article, task, lease: { ...data, token } };
    });
  }

  private where(lease: TaskLease) {
    return {
      id: lease.taskId,
      state: SummaryTaskState.RUNNING,
      leaseToken: lease.token,
      leaseExpiresAt: { gt: new Date() },
    };
  }

  async heartbeat(lease: TaskLease) {
    const result = await this.prisma.summaryTask.updateMany({
      where: this.where(lease),
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    });
    return result.count === 1;
  }

  async stage(lease: TaskLease, stage: string) {
    await this.prisma.$transaction(async (tx) => {
      // Hold the task row lock until its visible stage is updated, so an expired
      // worker cannot change the stage after a new lease has been claimed.
      const owned = await tx.summaryTask.updateMany({
        where: this.where(lease),
        data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
      });
      if (!owned.count)
        throw new SummaryGenerationError(
          '작업 소유권이 만료되었습니다.',
          'STALE_JOB',
          false,
        );
      const updated = await tx.savedArticle.updateMany({
        where: { id: lease.articleId, generation: lease.generation },
        data: { stage },
      });
      if (!updated.count)
        throw new SummaryGenerationError(
          '작업 대상이 변경되었습니다.',
          'STALE_JOB',
          false,
        );
    });
  }

  async checkpoint(lease: TaskLease, result: Prisma.InputJsonValue) {
    const updated = await this.prisma.summaryTask.updateMany({
      where: this.where(lease),
      data: { result },
    });
    if (!updated.count)
      throw new SummaryGenerationError(
        '작업 소유권이 만료되었습니다.',
        'STALE_JOB',
        false,
      );
  }

  async complete(
    lease: TaskLease,
    data: Prisma.SavedArticleUpdateManyMutationInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const won = await tx.summaryTask.updateMany({
        where: this.where(lease),
        data: {
          state: 'SUCCEEDED',
          leaseToken: null,
          leaseExpiresAt: null,
          result: Prisma.DbNull,
        },
      });
      if (!won.count) return false;
      const saved = await tx.savedArticle.updateMany({
        where: { id: lease.articleId, generation: lease.generation },
        data: {
          ...data,
          resultGeneration: lease.generation,
          generatedAt: new Date(),
          stage: 'DONE',
          errorCode: null,
          lastSummaryError: null,
          retryable: true,
          retryAt: null,
        },
      });
      return saved.count === 1;
    });
  }

  async fail(
    lease: TaskLease,
    failure: SummaryGenerationError,
    attempts: number,
  ) {
    const retry = failure.retryable && attempts < MAX_TASK_ATTEMPTS;
    const delay = Math.max(
      failure.retryAfterSeconds * 1000,
      3000 * 2 ** (attempts - 1) + Math.floor(Math.random() * 1000),
    );
    const next = new Date(Date.now() + delay);
    await this.prisma.$transaction(async (tx) => {
      const won = await tx.summaryTask.updateMany({
        where: this.where(lease),
        data: {
          state: retry ? 'PENDING' : 'FAILED',
          leaseToken: null,
          leaseExpiresAt: null,
          notBefore: next,
          // Keep checkpoint only across automatic retries, not as a second stored summary.
          ...(!retry ? { result: Prisma.DbNull } : {}),
        },
      });
      if (!won.count) return;
      await tx.savedArticle.updateMany({
        where: { id: lease.articleId, generation: lease.generation },
        data: {
          processStatus: retry ? 'SUMMARIZING' : 'SUMMARY_FAILED',
          stage: retry ? 'QUEUED' : 'FAILED',
          errorCode: failure.code,
          retryable: true,
          retryAt: retry || failure.retryAfterSeconds > 0 ? next : null,
          lastSummaryError: failure.message,
        },
      });
    });
  }
}
