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
import {
  SUMMARY_VARIANT_JOB,
  SUMMARY_VARIANT_QUEUE,
} from './summary.constants';
import { SummaryGenerationError } from './summary-errors';
import { LEASE_MS, MAX_TASK_ATTEMPTS } from './summary-job.service';

export type SummaryVariantJobData = {
  taskId: string;
  variantId: string;
  generation: number;
  sourceGeneration: number;
};

export type SummaryVariantLease = SummaryVariantJobData & { token: string };

@Injectable()
export class SummaryVariantJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SummaryVariantJobService.name);
  private timer?: ReturnType<typeof setInterval>;
  private dispatching = false;
  private pendingEnqueue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SUMMARY_VARIANT_QUEUE)
    private readonly queue: Queue<SummaryVariantJobData>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.dispatch(), 5000);
    this.timer.unref();
    void this.dispatch();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const now = new Date();
      const expired = await this.prisma.summaryVariantTask.findMany({
        where: {
          state: SummaryTaskState.RUNNING,
          leaseExpiresAt: { lte: now },
        },
        take: 50,
      });
      for (const task of expired) {
        await this.prisma.$transaction(async (tx) => {
          const terminal = task.attempts >= MAX_TASK_ATTEMPTS;
          const reclaimed = await tx.summaryVariantTask.updateMany({
            where: {
              id: task.id,
              state: SummaryTaskState.RUNNING,
              leaseExpiresAt: { lte: now },
            },
            data: {
              state: terminal
                ? SummaryTaskState.FAILED
                : SummaryTaskState.PENDING,
              leaseToken: null,
              leaseExpiresAt: null,
              notBefore: now,
            },
          });
          if (!reclaimed.count) return;
          await tx.summaryVariant.updateMany({
            where: {
              id: task.variantId,
              generation: task.generation,
              sourceGeneration: task.sourceGeneration,
            },
            data: {
              state: terminal
                ? SummaryTaskState.FAILED
                : SummaryTaskState.PENDING,
              errorCode: 'WORKER_INTERRUPTED',
              retryable: true,
              retryAt: terminal ? null : now,
              lastError:
                '요약 작업이 중단되었습니다. 해당 밀도를 다시 시도할 수 있어요.',
            },
          });
        });
      }

      const tasks = await this.prisma.summaryVariantTask.findMany({
        where: {
          state: SummaryTaskState.PENDING,
          notBefore: { lte: now },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const task of tasks) {
        let pending = this.pendingEnqueue.get(task.id);
        if (!pending) {
          pending = this.queue
            .add(
              SUMMARY_VARIANT_JOB,
              {
                taskId: task.id,
                variantId: task.variantId,
                generation: task.generation,
                sourceGeneration: task.sourceGeneration,
              },
              {
                jobId: task.id,
                attempts: 1,
                removeOnComplete: true,
                removeOnFail: true,
              },
            )
            .finally(() => this.pendingEnqueue.delete(task.id));
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
      this.logger.warn(
        'Summary variant dispatch unavailable; durable jobs remain queued.',
      );
    } finally {
      this.dispatching = false;
    }
  }

  async claim(data: SummaryVariantJobData) {
    if (
      !data.taskId ||
      !data.variantId ||
      !Number.isInteger(data.generation) ||
      !Number.isInteger(data.sourceGeneration)
    )
      return null;
    const token = randomUUID();
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.summaryVariant.findFirst({
        where: {
          id: data.variantId,
          generation: data.generation,
          sourceGeneration: data.sourceGeneration,
        },
        include: { article: true },
      });
      if (
        !variant ||
        variant.article.resultGeneration !== data.sourceGeneration ||
        !variant.article.rawText?.trim()
      ) {
        await tx.summaryVariantTask.updateMany({
          where: {
            id: data.taskId,
            variantId: data.variantId,
            generation: data.generation,
            state: SummaryTaskState.PENDING,
          },
          data: { state: SummaryTaskState.FAILED },
        });
        if (variant)
          await tx.summaryVariant.updateMany({
            where: {
              id: variant.id,
              generation: data.generation,
              sourceGeneration: data.sourceGeneration,
            },
            data: {
              state: SummaryTaskState.FAILED,
              errorCode: 'STALE_SOURCE',
              retryable: false,
              lastError:
                '요약에 사용한 원문이 변경되었습니다. 새 원문에서 다시 요청해 주세요.',
            },
          });
        return null;
      }
      const claimed = await tx.summaryVariantTask.updateMany({
        where: {
          id: data.taskId,
          variantId: data.variantId,
          generation: data.generation,
          sourceGeneration: data.sourceGeneration,
          state: SummaryTaskState.PENDING,
          notBefore: { lte: now },
          attempts: { lt: MAX_TASK_ATTEMPTS },
        },
        data: {
          state: SummaryTaskState.RUNNING,
          attempts: { increment: 1 },
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        },
      });
      if (!claimed.count) return null;
      await tx.summaryVariant.update({
        where: { id: variant.id },
        data: {
          state: SummaryTaskState.RUNNING,
          errorCode: null,
          retryAt: null,
          lastError: null,
        },
      });
      const task = await tx.summaryVariantTask.findUniqueOrThrow({
        where: { id: data.taskId },
      });
      return {
        variant,
        article: variant.article,
        task,
        lease: { ...data, token },
      };
    });
  }

  private where(lease: SummaryVariantLease) {
    return {
      id: lease.taskId,
      state: SummaryTaskState.RUNNING,
      leaseToken: lease.token,
      leaseExpiresAt: { gt: new Date() },
    };
  }

  async heartbeat(lease: SummaryVariantLease) {
    const result = await this.prisma.summaryVariantTask.updateMany({
      where: this.where(lease),
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    });
    return result.count === 1;
  }

  async checkpoint(lease: SummaryVariantLease, markdown: string) {
    const saved = await this.prisma.summaryVariantTask.updateMany({
      where: this.where(lease),
      data: { result: markdown },
    });
    if (!saved.count)
      throw new SummaryGenerationError(
        '작업 소유권이 만료되었습니다.',
        'STALE_JOB',
        false,
      );
  }

  async complete(lease: SummaryVariantLease, markdown: string) {
    return this.prisma.$transaction(async (tx) => {
      const won = await tx.summaryVariantTask.updateMany({
        where: this.where(lease),
        data: {
          state: SummaryTaskState.SUCCEEDED,
          leaseToken: null,
          leaseExpiresAt: null,
          result: Prisma.DbNull,
        },
      });
      if (!won.count) return false;
      const saved = await tx.summaryVariant.updateMany({
        where: {
          id: lease.variantId,
          generation: lease.generation,
          sourceGeneration: lease.sourceGeneration,
        },
        data: {
          state: SummaryTaskState.SUCCEEDED,
          markdown,
          generatedAt: new Date(),
          errorCode: null,
          retryable: true,
          retryAt: null,
          lastError: null,
        },
      });
      return saved.count === 1;
    });
  }

  async fail(
    lease: SummaryVariantLease,
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
      const won = await tx.summaryVariantTask.updateMany({
        where: this.where(lease),
        data: {
          state: retry ? SummaryTaskState.PENDING : SummaryTaskState.FAILED,
          leaseToken: null,
          leaseExpiresAt: null,
          notBefore: next,
          ...(!retry ? { result: Prisma.DbNull } : {}),
        },
      });
      if (!won.count) return;
      await tx.summaryVariant.updateMany({
        where: {
          id: lease.variantId,
          generation: lease.generation,
          sourceGeneration: lease.sourceGeneration,
        },
        data: {
          state: retry ? SummaryTaskState.PENDING : SummaryTaskState.FAILED,
          errorCode: failure.code,
          retryable: failure.retryable,
          retryAt: retry || failure.retryAfterSeconds > 0 ? next : null,
          lastError: failure.message,
        },
      });
    });
  }
}
