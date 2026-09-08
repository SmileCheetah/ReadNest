import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ProcessStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiSummaryService,
  SummaryGenerationError,
  validateSummaryMarkdown,
} from './ai-summary.service';
import { ContentExtractorService } from './content-extractor.service';
import { SUMMARY_QUEUE } from './summary.constants';
import { SummaryJobData } from './summary.service';
import { ThreadDetectionService } from './thread-detection.service';

@Processor(SUMMARY_QUEUE)
export class SummaryProcessor extends WorkerHost {
  private readonly logger = new Logger(SummaryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentExtractor: ContentExtractorService,
    private readonly aiSummaryService: AiSummaryService,
    private readonly threadDetectionService: ThreadDetectionService,
  ) {
    super();
  }

  async process(job: Job<SummaryJobData>) {
    const { articleId } = job.data;

    const article = await this.prisma.savedArticle.findUnique({
      where: {
        id: articleId,
      },
    });

    if (!article) {
      this.logger.warn(`Article not found: ${articleId}`);
      return;
    }

    try {
      const extractedContent = await this.contentExtractor.extract(article.url);
      const existingRawText = article.rawText?.trim();
      const textForSummary = [existingRawText, extractedContent.text]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 50000);
      const summary = await this.aiSummaryService.summarize({
        url: article.url,
        title: article.title ?? extractedContent.title,
        text: textForSummary,
      });
      if (!validateSummaryMarkdown(summary.meta.summaryMarkdown)) {
        throw new SummaryGenerationError(
          '요약 형식을 확인하지 못했습니다. 요약을 다시 생성해 주세요.',
        );
      }

      const updatedArticle = await this.prisma.savedArticle.update({
        where: {
          id: articleId,
        },
        data: {
          title: summary.title,
          rawText: textForSummary || null,
          summary: summary.summary,
          summaryMeta: summary.meta,
          keyPoints: summary.keyPoints,
          tags: summary.tags,
          extractionStatus: extractedContent.extractionStatus,
          extractionConfidence: extractedContent.extractionConfidence,
          lastSummaryError: null,
          processStatus: summary.contextInsufficient
            ? ProcessStatus.CONTEXT_INSUFFICIENT
            : ProcessStatus.SUMMARY_DONE,
        },
      });

      await this.threadDetectionService.detectAndLink({
        articleId,
        userId: updatedArticle.userId,
        title: summary.title,
        url: updatedArticle.url,
        text: [extractedContent.title, textForSummary, summary.title].join(
          '\n',
        ),
      });
    } catch (error) {
      const maxAttempts = Number(job.opts.attempts ?? 1);
      const willRetry = job.attemptsMade + 1 < maxAttempts;
      const safeMessage =
        error instanceof SummaryGenerationError
          ? error.message
          : '요약 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
      this.logger.warn(
        `Summary job failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.prisma.savedArticle.update({
        where: {
          id: articleId,
        },
        data: {
          processStatus: willRetry
            ? ProcessStatus.SUMMARIZING
            : ProcessStatus.SUMMARY_FAILED,
          lastSummaryError: safeMessage,
        },
      });

      throw error;
    }
  }
}
