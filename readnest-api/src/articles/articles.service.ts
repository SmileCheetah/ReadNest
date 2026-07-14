import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProcessStatus, ReadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../summary/summary.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';
import { normalizeUrl } from './utils/normalize-url';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaryService: SummaryService,
    private readonly configService: ConfigService,
  ) {}

  async create(userId: string, dto: CreateArticleDto) {
    const normalizedUrl = normalizeUrl(dto.url);
    await this.ensureDailySaveLimit(userId);

    try {
      const article = await this.prisma.savedArticle.create({
        data: {
          userId,
          url: dto.url,
          normalizedUrl,
          title: dto.title,
          processStatus: ProcessStatus.SUMMARIZING,
          readStatus: ReadStatus.UNREAD,
        },
      });

      await this.summaryService.enqueueArticleSummary(article.id);

      return article;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const updated = await this.prisma.savedArticle.update({
          where: {
            userId_normalizedUrl: {
              userId,
              normalizedUrl,
            },
          },
          data: {
            title: dto.title,
            rawText: null,
            summary: null,
            keyPoints: Prisma.JsonNull,
            tags: Prisma.JsonNull,
            processStatus: ProcessStatus.SUMMARIZING,
            lastSummaryError: null,
          },
        });

        await this.summaryService.enqueueArticleSummary(updated.id);

        return updated;
      }

      throw error;
    }
  }

  private async ensureDailySaveLimit(userId: string) {
    const limit = Number(
      this.configService.get<string>('DAILY_SAVE_LIMIT') ?? 50,
    );

    if (limit <= 0) return;

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const savedToday = await this.prisma.savedArticle.count({
      where: {
        userId,
        savedAt: {
          gte: startOfToday,
        },
      },
    });

    if (savedToday >= limit) {
      throw new BadRequestException(
        '오늘 저장 가능한 글 수를 초과했습니다. 내일 다시 시도해 주세요.',
      );
    }
  }

  async findAll(userId: string, query: ListArticlesQueryDto) {
    const where: Prisma.SavedArticleWhereInput = {
      userId,
      ...this.getPeriodWhere(query.period),
    };

    if (query.processStatus) {
      where.processStatus = query.processStatus;
    }

    if (query.readStatus) {
      where.readStatus = query.readStatus;
    }

    if (query.search) {
      where.OR = [
        {
          title: {
            contains: query.search,
          },
        },
        {
          summary: {
            contains: query.search,
          },
        },
        {
          url: {
            contains: query.search,
          },
        },
      ];
    }

    return this.prisma.savedArticle.findMany({
      where,
      orderBy: {
        savedAt: 'desc',
      },
      take: query.limit ?? 50,
    });
  }

  async getHome(userId: string) {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const [readingCandidates, summarizing, today, unreadCount, weekSavedCount] =
      await Promise.all([
        this.prisma.savedArticle.findMany({
          where: {
            userId,
            processStatus: ProcessStatus.SUMMARY_DONE,
            readStatus: {
              in: [ReadStatus.UNREAD, ReadStatus.READ_LATER],
            },
          },
          orderBy: {
            savedAt: 'desc',
          },
          take: 20,
        }),
        this.prisma.savedArticle.findMany({
          where: {
            userId,
            processStatus: ProcessStatus.SUMMARIZING,
          },
          orderBy: {
            savedAt: 'desc',
          },
          take: 10,
        }),
        this.prisma.savedArticle.findMany({
          where: {
            userId,
            savedAt: {
              gte: startOfToday,
            },
          },
          orderBy: {
            savedAt: 'desc',
          },
          take: 20,
        }),
        this.prisma.savedArticle.count({
          where: {
            userId,
            readStatus: ReadStatus.UNREAD,
          },
        }),
        this.prisma.savedArticle.count({
          where: {
            userId,
            savedAt: {
              gte: startOfWeek,
            },
          },
        }),
      ]);

    const readStatusPriority = {
      [ReadStatus.READ_LATER]: 0,
      [ReadStatus.UNREAD]: 1,
      [ReadStatus.READ]: 2,
    };

    return {
      todayReading: readingCandidates
        .sort(
          (a, b) =>
            readStatusPriority[a.readStatus] - readStatusPriority[b.readStatus],
        )
        .slice(0, 3),
      summarizing,
      today,
      unreadCount,
      weekSavedCount,
    };
  }

  async findOne(userId: string, id: string) {
    const article = await this.prisma.savedArticle.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        threadParts: {
          include: {
            threadGroup: true,
          },
        },
      },
    });

    if (!article) {
      throw new NotFoundException('저장글을 찾을 수 없습니다.');
    }

    return article;
  }

  async checkDuplicate(userId: string, url: string) {
    const normalizedUrl = normalizeUrl(url);
    const article = await this.prisma.savedArticle.findUnique({
      where: {
        userId_normalizedUrl: {
          userId,
          normalizedUrl,
        },
      },
    });

    return {
      duplicated: Boolean(article),
      article,
    };
  }

  async updateReadStatus(userId: string, id: string, readStatus: ReadStatus) {
    await this.ensureOwnedArticle(userId, id);

    return this.prisma.savedArticle.update({
      where: {
        id,
      },
      data: {
        readStatus,
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnedArticle(userId, id);

    await this.prisma.savedArticle.delete({
      where: {
        id,
      },
    });

    return {
      deleted: true,
      id,
    };
  }

  private async ensureOwnedArticle(userId: string, id: string) {
    const article = await this.prisma.savedArticle.findFirst({
      where: {
        id,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!article) {
      throw new NotFoundException('저장글을 찾을 수 없습니다.');
    }
  }

  private getPeriodWhere(
    period: ListArticlesQueryDto['period'] = 'all',
  ): Prisma.SavedArticleWhereInput {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    if (period === 'today') {
      return {
        savedAt: {
          gte: startOfToday,
        },
      };
    }

    if (period === 'week') {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - start.getDay());

      return {
        savedAt: {
          gte: start,
        },
      };
    }

    if (period === 'last-week') {
      const end = new Date(startOfToday);
      end.setDate(end.getDate() - end.getDay());

      const start = new Date(end);
      start.setDate(start.getDate() - 7);

      return {
        savedAt: {
          gte: start,
          lt: end,
        },
      };
    }

    if (period === 'month') {
      return {
        savedAt: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
        },
      };
    }

    return {};
  }
}
