import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SummaryDensity, SummaryTaskState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateSummaryMarkdown } from './summary-markdown-validator';
import { SummaryVariantJobService } from './summary-variant-job.service';

type PublicVariantInput = {
  density: SummaryDensity;
  sourceGeneration: number;
  state: SummaryTaskState;
  markdown: string | null;
  errorCode: string | null;
  retryable: boolean;
  retryAt: Date | null;
  generatedAt: Date | null;
};

export function summaryVariantDto(variant: PublicVariantInput) {
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil(((variant.retryAt?.getTime() ?? 0) - Date.now()) / 1000),
  );
  const validMarkdown =
    variant.state === SummaryTaskState.SUCCEEDED &&
    validateSummaryMarkdown(variant.markdown)
      ? variant.markdown
      : undefined;
  return {
    density: variant.density,
    sourceGeneration: variant.sourceGeneration,
    state: variant.state,
    ...(validMarkdown ? { summaryMarkdown: validMarkdown } : {}),
    errorCode: variant.errorCode,
    retryable:
      variant.state === SummaryTaskState.FAILED &&
      variant.errorCode !== 'STALE_SOURCE' &&
      retryAfterSeconds === 0,
    retryAfterSeconds,
    generatedAt: variant.generatedAt,
  };
}

export function parseSummaryDensity(value: string) {
  const density = value.trim().toUpperCase();
  if (density === SummaryDensity.CONCISE) return SummaryDensity.CONCISE;
  if (density === SummaryDensity.DETAILED) return SummaryDensity.DETAILED;
  throw new BadRequestException(
    '요약 밀도는 concise 또는 detailed만 요청할 수 있습니다.',
  );
}

@Injectable()
export class SummaryVariantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: SummaryVariantJobService,
  ) {}

  async list(userId: string, articleId: string) {
    const article = await this.prisma.savedArticle.findFirst({
      where: { id: articleId, userId },
      select: {
        resultGeneration: true,
        summaryVariants: true,
      },
    });
    if (!article) throw new NotFoundException('저장글을 찾을 수 없습니다.');
    return {
      sourceGeneration: article.resultGeneration,
      variants: article.summaryVariants
        .filter(
          (variant) =>
            article.resultGeneration !== null &&
            variant.sourceGeneration === article.resultGeneration,
        )
        .map(summaryVariantDto),
    };
  }

  async request(
    userId: string,
    articleId: string,
    densityInput: string,
    requestKey?: string,
  ) {
    const density = parseSummaryDensity(densityInput);
    if (requestKey && !/^[A-Za-z0-9_-]{1,128}$/.test(requestKey)) {
      throw new BadRequestException(
        'Idempotency-Key 형식이 올바르지 않습니다.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM saved_articles WHERE id = ${articleId} FOR UPDATE`;
      const article = await tx.savedArticle.findFirst({
        where: { id: articleId, userId },
        select: {
          id: true,
          rawText: true,
          resultGeneration: true,
        },
      });
      if (!article) throw new NotFoundException('저장글을 찾을 수 없습니다.');
      if (!article.resultGeneration || !article.rawText?.trim()) {
        throw new BadRequestException(
          '기본 요약과 수집 원문이 준비된 후 다른 밀도를 만들 수 있습니다.',
        );
      }

      const existing = await tx.summaryVariant.findUnique({
        where: { articleId_density: { articleId, density } },
      });
      const current =
        existing?.sourceGeneration === article.resultGeneration
          ? existing
          : null;
      if (
        current &&
        ((current.state === SummaryTaskState.SUCCEEDED &&
          validateSummaryMarkdown(current.markdown)) ||
          current.state === SummaryTaskState.PENDING ||
          current.state === SummaryTaskState.RUNNING)
      ) {
        return { variant: current, enqueued: false };
      }
      if (current?.retryAt && current.retryAt.getTime() > Date.now()) {
        throw new HttpException(
          {
            message: '잠시 후 해당 요약을 다시 요청해 주세요.',
            errorCode: 'RETRY_COOLDOWN',
            retryAfterSeconds: Math.ceil(
              (current.retryAt.getTime() - Date.now()) / 1000,
            ),
          },
          429,
        );
      }
      let taskRequestKey = requestKey;
      if (requestKey && existing) {
        const duplicate = await tx.summaryVariantTask.findUnique({
          where: {
            variantId_requestKey: {
              variantId: existing.id,
              requestKey,
            },
          },
        });
        if (duplicate && current) return { variant: current, enqueued: false };
        if (duplicate) taskRequestKey = undefined;
      }

      const generation = (existing?.generation ?? 0) + 1;
      const next = existing
        ? await tx.summaryVariant.update({
            where: { id: existing.id },
            data: {
              generation,
              sourceGeneration: article.resultGeneration,
              state: SummaryTaskState.PENDING,
              markdown: null,
              errorCode: null,
              retryable: true,
              retryAt: null,
              lastError: null,
              generatedAt: null,
            },
          })
        : await tx.summaryVariant.create({
            data: {
              articleId,
              density,
              generation,
              sourceGeneration: article.resultGeneration,
            },
          });
      await tx.summaryVariantTask.create({
        data: {
          variantId: next.id,
          generation,
          sourceGeneration: article.resultGeneration,
          requestKey: taskRequestKey,
        },
      });
      return { variant: next, enqueued: true };
    });

    if (result.enqueued) void this.jobs.dispatch();
    return summaryVariantDto(result.variant);
  }
}
