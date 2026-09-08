import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProcessStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SUMMARY_ARTICLE_JOB, SUMMARY_QUEUE } from './summary.constants';

export type SummaryJobData = {
  articleId: string;
};

@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue(SUMMARY_QUEUE)
    private readonly summaryQueue: Queue<SummaryJobData>,
  ) {}

  async enqueueArticleSummary(articleId: string) {
    await this.summaryQueue.add(
      SUMMARY_ARTICLE_JOB,
      { articleId },
      {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async retryArticleSummary(userId: string, articleId: string) {
    const article = await this.prisma.savedArticle.findFirst({
      where: {
        id: articleId,
        userId,
      },
      select: {
        id: true,
        summaryRetryCount: true,
      },
    });

    if (!article) {
      throw new NotFoundException('저장글을 찾을 수 없습니다.');
    }

    const maxRetries = Number(
      this.configService.get<string>('SUMMARY_RETRY_LIMIT') ?? 3,
    );

    if (article.summaryRetryCount >= maxRetries) {
      throw new BadRequestException(
        '요약 재시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }

    const updated = await this.prisma.savedArticle.update({
      where: {
        id: articleId,
      },
      data: {
        processStatus: ProcessStatus.SUMMARIZING,
        summaryRetryCount: {
          increment: 1,
        },
        lastSummaryError: null,
      },
    });

    await this.enqueueArticleSummary(articleId);

    return updated;
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
        summary: true,
        updatedAt: true,
      },
    });

    if (!article) {
      throw new NotFoundException('저장글을 찾을 수 없습니다.');
    }

    return article;
  }
}
