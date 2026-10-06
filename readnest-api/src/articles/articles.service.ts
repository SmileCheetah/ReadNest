import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProcessStatus, ReadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../summary/summary.service';
import { summaryVariantDto } from '../summary/summary-variant.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';
import { parseThreadsUrl } from './utils/normalize-url';
import { summaryPreview, withArticleStatus } from './utils/summary-preview';
import {
  articleListSelect,
  cursorScope,
  decodeCursor,
  encodeCursor,
  productCalendar,
} from './utils/article-list';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaryService: SummaryService,
    private readonly configService: ConfigService,
  ) {}

  async create(userId: string, dto: CreateArticleDto) {
    const link = parseThreadsUrl(dto.url);
    if (dto.title && Array.from(dto.title).length > 191)
      throw new BadRequestException('제목은 191자 이하로 입력해 주세요.');
    const article = await this.prisma.$transaction(async (tx) => {
      const users = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      if (!users.length)
        throw new UnauthorizedException('로그인이 필요합니다.');
      const existing = await this.findExisting(tx, userId, dto.url);
      if (existing) return existing;
      await this.ensureDailySaveLimit(userId, tx);
      const saved = await tx.savedArticle.create({
        data: {
          userId,
          url: link.canonical,
          normalizedUrl: link.identity,
          title: dto.title,
          author: link.author,
          generation: 1,
          stage: 'QUEUED',
          processStatus: ProcessStatus.SUMMARIZING,
          readStatus: ReadStatus.UNREAD,
        },
      });
      await tx.summaryTask.create({
        data: { articleId: saved.id, generation: 1 },
      });
      return saved;
    });
    this.summaryService.enqueueArticleSummary(article.id);
    return withArticleStatus(article);
  }

  private async findExisting(
    client: Prisma.TransactionClient,
    userId: string,
    input: string,
  ) {
    const link = parseThreadsUrl(input);
    const canonical = await client.savedArticle.findUnique({
      where: { userId_normalizedUrl: { userId, normalizedUrl: link.identity } },
    });
    if (canonical) return canonical;
    // Read-only compatibility with old URL keys; never merge/delete historical rows.
    const legacy = await client.savedArticle.findMany({
      where: {
        userId,
        normalizedUrl: { contains: `/post/${link.postId}` },
      },
      orderBy: [{ savedAt: 'asc' }, { id: 'asc' }],
    });
    return (
      legacy.find((article) => {
        try {
          return parseThreadsUrl(article.url).postId === link.postId;
        } catch {
          return false;
        }
      }) ?? null
    );
  }

  private async ensureDailySaveLimit(
    userId: string,
    client: Prisma.TransactionClient,
  ) {
    const limit = Number(
      this.configService.get<string>('DAILY_SAVE_LIMIT') ?? 50,
    );

    if (limit <= 0) return;

    const startOfToday = productCalendar().today;
    const savedToday = await client.savedArticle.count({
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

    if (query.pagination === 'cursor') {
      const scope = cursorScope(userId, {
        period: query.period ?? 'all',
        processStatus: query.processStatus ?? null,
        readStatus: query.readStatus ?? null,
        search: query.search ?? '',
      });
      const secret = this.configService.getOrThrow<string>('JWT_SECRET');
      const cursor = query.cursor
        ? decodeCursor(query.cursor, scope, secret)
        : null;
      const limit = query.limit ?? 30;
      const items = await this.prisma.savedArticle.findMany({
        where: {
          AND: [
            where,
            ...(cursor
              ? [
                  {
                    OR: [
                      { savedAt: { lt: cursor.savedAt } },
                      { savedAt: cursor.savedAt, id: { lt: cursor.id } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ savedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: articleListSelect,
      });
      const visible = items.slice(0, limit);
      // Historical rows have no persisted preview. Fetch only this page's missing
      // documents in one owner-scoped batch, without leaking them into list output.
      const missingPreviewIds = visible
        .filter((item) => item.summaryPreview === null)
        .map((item) => item.id);
      const legacyDocuments = missingPreviewIds.length
        ? await this.prisma.savedArticle.findMany({
            where: { userId, id: { in: missingPreviewIds } },
            select: { id: true, summaryMeta: true, summary: true },
          })
        : [];
      const previews = new Map(
        legacyDocuments.map((item) => {
          const meta = item.summaryMeta as { summaryMarkdown?: unknown } | null;
          return [
            item.id,
            summaryPreview(meta?.summaryMarkdown ?? item.summary),
          ] as const;
        }),
      );
      return {
        items: visible.map((item) =>
          withArticleStatus({
            ...item,
            summaryPreview:
              item.summaryPreview ?? previews.get(item.id) ?? null,
          }),
        ),
        nextCursor:
          items.length > limit
            ? encodeCursor(visible[visible.length - 1], scope, secret)
            : null,
      };
    }
    const articles = await this.prisma.savedArticle.findMany({
      where,
      orderBy: {
        savedAt: 'desc',
      },
      take: query.limit ?? 50,
    });
    // Legacy array response is preserved for older clients.
    return articles.map(withArticleStatus);
  }

  async getHome(userId: string) {
    const { today: startOfToday, week: startOfWeek } = productCalendar();

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
        .slice(0, 3)
        .map(withArticleStatus),
      summarizing: summarizing.map(withArticleStatus),
      today: today.map(withArticleStatus),
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
        summaryVariants: true,
      },
    });

    if (!article) {
      throw new NotFoundException('저장글을 찾을 수 없습니다.');
    }

    const { summaryVariants, ...savedArticle } = article;
    return {
      ...withArticleStatus(savedArticle),
      summaryVariants: summaryVariants
        .filter(
          (variant) =>
            article.resultGeneration !== null &&
            variant.sourceGeneration === article.resultGeneration,
        )
        .map(summaryVariantDto),
    };
  }

  async checkDuplicate(userId: string, url: string) {
    const article = await this.findExisting(this.prisma, userId, url);

    return {
      duplicated: Boolean(article),
      article: article ? withArticleStatus(article) : null,
    };
  }

  async updateReadStatus(userId: string, id: string, readStatus: ReadStatus) {
    await this.ensureOwnedArticle(userId, id);

    const article = await this.prisma.savedArticle.update({
      where: {
        id,
      },
      data: {
        readStatus,
      },
    });
    return withArticleStatus(article);
  }

  async remove(userId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      // Match the knowledge write lock order so source deletion and membership
      // edits cannot race and silently invalidate a topic's revision.
      const users = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      if (!users.length)
        throw new UnauthorizedException('로그인이 필요합니다.');
      const articles = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM saved_articles WHERE id = ${id} AND userId = ${userId} FOR UPDATE`;
      if (!articles.length)
        throw new NotFoundException('저장한 글을 찾을 수 없습니다.');
      await tx.knowledgeTopic.updateMany({
        where: { userId, articles: { some: { articleId: id } } },
        data: { revision: { increment: 1 } },
      });
      await tx.savedArticle.delete({ where: { id, userId } });
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
    const { today: startOfToday, week, month } = productCalendar();

    if (period === 'today') {
      return {
        savedAt: {
          gte: startOfToday,
        },
      };
    }

    if (period === 'week') {
      const start = week;

      return {
        savedAt: {
          gte: start,
        },
      };
    }

    if (period === 'last-week') {
      const end = week;
      const start = new Date(end.getTime() - 7 * 86400_000);

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
          gte: month,
        },
      };
    }

    return {};
  }
}
