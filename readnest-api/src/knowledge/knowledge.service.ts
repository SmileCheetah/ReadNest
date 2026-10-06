import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  articleListSelect,
  cursorScope,
  decodeCursor,
  encodeCursor,
} from '../articles/utils/article-list';
import {
  summaryPreview,
  withArticleStatus,
} from '../articles/utils/summary-preview';
import {
  CreateTopicDto,
  ListTopicsQueryDto,
  UpdateTopicDto,
} from './dto/topic.dto';
import { normalizeTopicDescription, normalizeTopicName } from './topic-input';

const topicSelect = {
  id: true,
  name: true,
  description: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { articles: true } },
} satisfies Prisma.KnowledgeTopicSelect;
type TopicRow = Prisma.KnowledgeTopicGetPayload<{ select: typeof topicSelect }>;
type Db = Prisma.TransactionClient;

function topicDto(topic: TopicRow) {
  const { _count, createdAt, updatedAt, ...fields } = topic;
  return {
    ...fields,
    articleCount: _count.articles,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private pagination(userId: string, route: string, query: ListTopicsQueryDto) {
    const limit = query.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('목록 크기는 1~100이어야 합니다.');
    if (
      query.search !== undefined &&
      (typeof query.search !== 'string' ||
        Array.from(query.search).length > 200)
    )
      throw new BadRequestException('검색어는 200자 이하로 입력해 주세요.');
    const search = query.search?.normalize('NFC').trim() ?? '';
    const scope = cursorScope(userId, {
      resource: 'knowledge-v1',
      route,
      search,
    });
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    if (
      query.cursor !== undefined &&
      (typeof query.cursor !== 'string' || query.cursor.length > 2048)
    )
      throw new BadRequestException('목록 커서가 유효하지 않습니다.');
    const cursor = query.cursor
      ? decodeCursor(query.cursor, scope, secret)
      : null;
    return { limit, search, scope, secret, cursor };
  }

  private async requireUser(tx: Db, userId: string) {
    // All topic writes take this owner lock first: deterministic lock order also
    // serializes normalized-name creation and idempotent membership changes.
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!rows.length) throw new UnauthorizedException('로그인이 필요합니다.');
  }

  private async lockTopic(tx: Db, userId: string, id: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM knowledge_topics WHERE id = ${id} AND userId = ${userId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('주제를 찾을 수 없습니다.');
  }

  private async requireTopic(db: Db, userId: string, id: string) {
    const topic = await db.knowledgeTopic.findFirst({
      where: { id, userId },
      select: topicSelect,
    });
    if (!topic) throw new NotFoundException('주제를 찾을 수 없습니다.');
    return topic;
  }

  private async requireArticle(db: Db, userId: string, id: string) {
    const article = await db.savedArticle.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('저장한 글을 찾을 수 없습니다.');
  }

  private async ensureUniqueName(
    tx: Db,
    userId: string,
    nameKey: string,
    exceptId?: string,
  ) {
    const existing = await tx.knowledgeTopic.findFirst({
      where: {
        userId,
        nameKey,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException({
        statusCode: 409,
        code: 'TOPIC_NAME_EXISTS',
        existingTopicId: existing.id,
        message: '같은 이름의 주제가 이미 있습니다. 기존 주제를 선택해 주세요.',
      });
  }

  async createTopic(userId: string, body: CreateTopicDto) {
    const name = normalizeTopicName(body.name);
    const description = normalizeTopicDescription(body.description);
    return this.prisma.$transaction(async (tx) => {
      await this.requireUser(tx, userId);
      await this.ensureUniqueName(tx, userId, name.nameKey);
      const topic = await tx.knowledgeTopic.create({
        data: { userId, ...name, description },
        select: topicSelect,
      });
      return topicDto(topic);
    });
  }

  async getTopic(userId: string, id: string) {
    return topicDto(await this.requireTopic(this.prisma, userId, id));
  }

  async updateTopic(userId: string, id: string, body: UpdateTopicDto) {
    if (
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 1 ||
      body.expectedRevision > 2147483646
    )
      throw new BadRequestException(
        '현재 주제 버전이 필요합니다. 다시 불러와 주세요.',
      );
    if (body.name === undefined && body.description === undefined)
      throw new BadRequestException('수정할 이름 또는 설명을 입력해 주세요.');
    const name =
      body.name === undefined ? undefined : normalizeTopicName(body.name);
    const description =
      body.description === undefined
        ? undefined
        : normalizeTopicDescription(body.description);
    return this.prisma.$transaction(async (tx) => {
      await this.requireUser(tx, userId);
      await this.lockTopic(tx, userId, id);
      const topic = await this.requireTopic(tx, userId, id);
      if (topic.revision !== body.expectedRevision)
        throw this.revisionConflict(topic.revision);
      if (name) await this.ensureUniqueName(tx, userId, name.nameKey, id);
      if (
        (!name || name.name === topic.name) &&
        (description === undefined || description === topic.description)
      )
        return topicDto(topic);
      const changed = await tx.knowledgeTopic.updateMany({
        where: { id, userId, revision: body.expectedRevision },
        data: {
          ...name,
          ...(description !== undefined ? { description } : {}),
          revision: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw this.revisionConflict(topic.revision);
      return topicDto(await this.requireTopic(tx, userId, id));
    });
  }

  private revisionConflict(currentRevision: number) {
    return new ConflictException({
      statusCode: 409,
      code: 'TOPIC_REVISION_CONFLICT',
      currentRevision,
      message:
        '주제가 다른 곳에서 변경되었습니다. 작성한 내용은 유지하고 최신 주제를 다시 불러와 주세요.',
    });
  }

  async deleteTopic(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireUser(tx, userId);
      await this.lockTopic(tx, userId, id);
      await tx.knowledgeTopic.delete({ where: { id, userId } });
      // Only the topic and its membership rows cascade; source articles survive.
      return { deleted: true, id };
    });
  }

  async setMembership(
    userId: string,
    topicId: string,
    articleId: string,
    linked: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireUser(tx, userId);
      await this.lockTopic(tx, userId, topicId);
      const articles = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM saved_articles WHERE id = ${articleId} AND userId = ${userId} FOR UPDATE`;
      if (!articles.length)
        throw new NotFoundException('저장한 글을 찾을 수 없습니다.');
      const existing = await tx.topicArticle.findUnique({
        where: { topicId_articleId: { topicId, articleId } },
      });
      if (linked && !existing)
        await tx.topicArticle.create({ data: { topicId, articleId } });
      if (!linked && existing)
        await tx.topicArticle.delete({
          where: { topicId_articleId: { topicId, articleId } },
        });
      if (linked !== Boolean(existing))
        await tx.knowledgeTopic.updateMany({
          where: { id: topicId, userId },
          data: { revision: { increment: 1 } },
        });
      return topicDto(await this.requireTopic(tx, userId, topicId));
    });
  }

  async listTopics(
    userId: string,
    query: ListTopicsQueryDto,
    articleId?: string,
  ) {
    const page = this.pagination(
      userId,
      articleId ? `article:${articleId}:topics` : 'topics',
      query,
    );
    const { cursor, limit, search, scope, secret } = page;
    const items = await this.prisma.knowledgeTopic.findMany({
      where: {
        AND: [
          { userId },
          ...(articleId
            ? [{ articles: { some: { articleId, article: { userId } } } }]
            : []),
          ...(search
            ? [
                {
                  OR: [
                    { name: { contains: search } },
                    { description: { contains: search } },
                  ],
                },
              ]
            : []),
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.savedAt } },
                    { createdAt: cursor.savedAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: topicSelect,
    });
    const visible = items.slice(0, limit);
    const last = visible[visible.length - 1];
    return {
      items: visible.map(topicDto),
      nextCursor:
        items.length > limit
          ? encodeCursor(
              { id: last.id, savedAt: last.createdAt },
              scope,
              secret,
            )
          : null,
    };
  }

  async listArticleTopics(
    userId: string,
    articleId: string,
    query: ListTopicsQueryDto,
  ) {
    await this.requireArticle(this.prisma, userId, articleId);
    return this.listTopics(userId, query, articleId);
  }

  async listTopicArticles(
    userId: string,
    topicId: string,
    query: ListTopicsQueryDto,
  ) {
    await this.requireTopic(this.prisma, userId, topicId);
    const { cursor, limit, search, scope, secret } = this.pagination(
      userId,
      `topic:${topicId}:articles`,
      query,
    );
    const items = await this.prisma.savedArticle.findMany({
      where: {
        AND: [
          { userId, topicArticles: { some: { topicId, topic: { userId } } } },
          ...(search
            ? [
                {
                  OR: [
                    { title: { contains: search } },
                    { summary: { contains: search } },
                    { url: { contains: search } },
                  ],
                },
              ]
            : []),
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
    const missing = visible
      .filter((item) => item.summaryPreview === null)
      .map((item) => item.id);
    const oldDocuments = missing.length
      ? await this.prisma.savedArticle.findMany({
          where: { userId, id: { in: missing } },
          select: { id: true, summaryMeta: true, summary: true },
        })
      : [];
    const previews = new Map(
      oldDocuments.map((item) => {
        const meta = item.summaryMeta as { summaryMarkdown?: unknown } | null;
        return [
          item.id,
          summaryPreview(meta?.summaryMarkdown ?? item.summary),
        ] as const;
      }),
    );
    return {
      items: visible.map((item) => {
        // Do not expose worker/provider diagnostic text through this new list.
        const { lastSummaryError: _privateError, ...publicFields } = item;
        void _privateError;
        return withArticleStatus({
          ...publicFields,
          summaryPreview: item.summaryPreview ?? previews.get(item.id) ?? null,
        });
      }),
      nextCursor:
        items.length > limit
          ? encodeCursor(visible[visible.length - 1], scope, secret)
          : null,
    };
  }
}
