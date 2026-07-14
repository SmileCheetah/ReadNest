import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ProcessStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AiSummaryService } from './ai-summary.service';
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
      await this.prisma.savedArticle.update({
        where: {
          id: articleId,
        },
        data: {
          processStatus: ProcessStatus.SUMMARY_FAILED,
          lastSummaryError:
            error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  }
}
