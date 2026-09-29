import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProcessStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  positiveInteger,
  withArticleStatus,
} from '../articles/utils/summary-preview';
import { SummaryJobService } from './summary-job.service';
import { SummaryVariantService } from './summary-variant.service';
export type { SummaryJobData } from './summary-job.service';

@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly jobs: SummaryJobService,
    private readonly variants: SummaryVariantService,
  ) {}

  enqueueArticleSummary(articleId: string) {
    // Kept for compatibility with callers; DB record must be created transactionally.
    void articleId;
    void this.jobs.dispatch();
  }

  async retryArticleSummary(
    userId: string,
    articleId: string,
    requestKey?: string,
  ) {
    if (requestKey && !/^[A-Za-z0-9_-]{1,128}$/.test(requestKey)) {
      throw new BadRequestException(
        'Idempotency-Key 형식이 올바르지 않습니다.',
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // Serialize user quota and concurrent retries. No external call under this lock.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const article = await tx.savedArticle.findFirst({
        where: { id: articleId, userId },
      });
      if (!article) throw new NotFoundException('저장글을 찾을 수 없습니다.');
      if (
        requestKey &&
        (await tx.summaryTask.findUnique({
          where: { articleId_requestKey: { articleId, requestKey } },
        }))
      )
        return article;
      if (article.processStatus === ProcessStatus.SUMMARIZING) return article;
      const now = Date.now();
      const windowMs =
        positiveInteger(
          this.configService.get('SUMMARY_RETRY_WINDOW_SECONDS'),
          3600,
          60,
        ) * 1000;
      const windowStart = article.retryWindowStartedAt?.getTime() ?? 0;
      const inWindow = now - windowStart < windowMs;
      const count = inWindow ? article.summaryRetryCount : 0;
      const maxRetries = positiveInteger(
        this.configService.get('SUMMARY_RETRY_LIMIT'),
        3,
      );
      if (article.retryAt && article.retryAt.getTime() > now) {
        throw new HttpException(
          {
            message: '잠시 후 다시 요약해 주세요.',
            errorCode: 'RETRY_COOLDOWN',
            retryAfterSeconds: Math.ceil(
              (article.retryAt.getTime() - now) / 1000,
            ),
          },
          429,
        );
      }
      if (count >= maxRetries) {
        throw new HttpException(
          {
            message:
              '요약 재시도 한도에 도달했습니다. 대기 후 다시 시도해 주세요.',
            errorCode: 'RETRY_LIMIT',
            retryAfterSeconds: Math.ceil((windowStart + windowMs - now) / 1000),
          },
          429,
        );
      }
      const generation = article.generation + 1;
      const result = await tx.savedArticle.update({
        where: { id: articleId },
        data: {
          generation,
          processStatus: ProcessStatus.SUMMARIZING,
          stage: 'QUEUED',
          summaryRetryCount: count + 1,
          retryWindowStartedAt: inWindow
            ? article.retryWindowStartedAt
            : new Date(now),
          lastSummaryError: null,
          errorCode: null,
          retryable: true,
          retryAt: null,
        },
      });
      await tx.summaryTask.create({
        data: { articleId, generation, requestKey },
      });
      return result;
    });
    void this.jobs.dispatch();
    return withArticleStatus(updated);
  }

  async getArticleSummaryStatus(userId: string, articleId: string) {
    const article = await this.prisma.savedArticle.findFirst({
      where: {
        id: articleId,
        userId,
      },
      select: {
        id: true,
        processStatus: true,
        readStatus: true,
        generation: true,
        resultGeneration: true,
        generatedAt: true,
        stage: true,
        errorCode: true,
        retryable: true,
        retryAt: true,
        lastSummaryError: true,
        summaryRetryCount: true,
        retryWindowStartedAt: true,
        updatedAt: true,
        sourceCompleteness: true,
        summaryPreview: true,
      },
    });

    if (!article) {
      throw new NotFoundException('저장글을 찾을 수 없습니다.');
    }

    return withArticleStatus(article);
  }

  getArticleSummaryVariants(userId: string, articleId: string) {
    return this.variants.list(userId, articleId);
  }

  requestArticleSummaryVariant(
    userId: string,
    articleId: string,
    density: string,
    requestKey?: string,
  ) {
    return this.variants.request(userId, articleId, density, requestKey);
  }
}
