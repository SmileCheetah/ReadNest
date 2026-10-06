import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';
import { normalizeTopicDescription, normalizeTopicName } from './topic-input';

const createdAt = new Date('2026-10-07T00:00:00.000Z');
const topic = (id = 'topic-1', revision = 1, articleCount = 0) => ({
  id,
  name: 'AI 활용',
  description: null,
  revision,
  createdAt,
  updatedAt: createdAt,
  _count: { articles: articleCount },
});

function setup() {
  const tx = {
    $queryRaw: jest
      .fn<
        Promise<Array<{ id: string }>>,
        [TemplateStringsArray, ...unknown[]]
      >()
      .mockResolvedValue([{ id: 'owner' }]),
    knowledgeTopic: {
      findFirst: jest.fn().mockResolvedValue(topic()),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(topic()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue(topic()),
    },
    topicArticle: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    savedArticle: {
      findFirst: jest.fn().mockResolvedValue({ id: 'article-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((callback: (db: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const service = new KnowledgeService(
    prisma as never,
    new ConfigService({ JWT_SECRET: 'test-cursor-key' }),
  );
  return { service, tx, prisma };
}

describe('knowledge input', () => {
  it('normalizes spaces/Unicode and duplicate names independently of DB collation', () => {
    expect(normalizeTopicName('  AI   활용  ').name).toBe('AI 활용');
    expect(normalizeTopicName('ＡＩ 활용').nameKey).toBe(
      normalizeTopicName('ai 활용').nameKey,
    );
    expect(normalizeTopicName('한글').name).toBe('한글');
    expect(normalizeTopicName('resume').nameKey).not.toBe(
      normalizeTopicName('résumé').nameKey,
    );
  });
  it('enforces codepoint limits without truncating non-BMP names or descriptions', () => {
    expect(normalizeTopicName('😀'.repeat(80)).name).toHaveLength(160);
    expect(() => normalizeTopicName('😀'.repeat(81))).toThrow(
      BadRequestException,
    );
    expect(normalizeTopicDescription('😀'.repeat(2000))).toHaveLength(4000);
    expect(() => normalizeTopicDescription('😀'.repeat(2001))).toThrow(
      BadRequestException,
    );
    expect(() => normalizeTopicName(' \n ')).toThrow(BadRequestException);
    expect(() => normalizeTopicName(null)).toThrow(BadRequestException);
    expect(() => normalizeTopicName('\u200b')).toThrow(BadRequestException);
    expect(normalizeTopicName('👨‍👩‍👧 가족').name).toBe('👨‍👩‍👧 가족');
    expect(normalizeTopicDescription('  ')).toBeNull();
    expect(normalizeTopicDescription(null)).toBeNull();
  });
});

describe('knowledge CRUD and authorization', () => {
  it('creates an owner topic after owner lock and returns no owner/name key', async () => {
    const { service, tx } = setup();
    tx.knowledgeTopic.findFirst.mockResolvedValue(null);
    const result = await service.createTopic('owner', {
      name: ' AI 활용 ',
      description: ' 설명 ',
    });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['owner']);
    expect(tx.knowledgeTopic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'owner',
          ...normalizeTopicName('AI 활용'),
          description: '설명',
        },
      }),
    );
    expect(result).toEqual({
      id: 'topic-1',
      name: 'AI 활용',
      description: null,
      revision: 1,
      articleCount: 0,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
  });
  it('rejects duplicate names with an owner-scoped existing topic identifier', async () => {
    const { service, tx } = setup();
    await expect(
      service.createTopic('owner', { name: 'AI 활용' }),
    ).rejects.toMatchObject({
      response: { code: 'TOPIC_NAME_EXISTS', existingTopicId: 'topic-1' },
    });
    expect(tx.knowledgeTopic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner',
          nameKey: normalizeTopicName('AI 활용').nameKey,
        },
      }),
    );
    expect(tx.knowledgeTopic.create).not.toHaveBeenCalled();
  });
  it('rejects deleted accounts before creating anything', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      service.createTopic('missing', { name: 'AI' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.knowledgeTopic.create).not.toHaveBeenCalled();
  });
  it('uses owner filters for topic and article membership reads; missing/foreign resources are 404', async () => {
    const { service, tx } = setup();
    tx.knowledgeTopic.findFirst.mockResolvedValue(null);
    await expect(service.getTopic('other', 'topic-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.listTopicArticles('other', 'topic-1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.knowledgeTopic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'topic-1', userId: 'other' } }),
    );
    tx.savedArticle.findFirst.mockResolvedValue(null);
    await expect(
      service.listArticleTopics('other', 'article-1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.savedArticle.findFirst).toHaveBeenCalledWith({
      where: { id: 'article-1', userId: 'other' },
      select: { id: true },
    });
    expect(tx.savedArticle.findMany).not.toHaveBeenCalled();
  });
  it('rejects stale revisions without losing the current document', async () => {
    const { service, tx } = setup();
    tx.knowledgeTopic.findFirst.mockResolvedValue(topic('topic-1', 3));
    await expect(
      service.updateTopic('owner', 'topic-1', {
        name: 'new',
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({
      response: { code: 'TOPIC_REVISION_CONFLICT', currentRevision: 3 },
    });
    expect(tx.knowledgeTopic.updateMany).not.toHaveBeenCalled();
  });
  it('edits with CAS and increments revision; missing descriptions remain unchanged', async () => {
    const { service, tx } = setup();
    tx.knowledgeTopic.findFirst
      .mockResolvedValueOnce(topic())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(topic('topic-1', 2));
    const result = await service.updateTopic('owner', 'topic-1', {
      name: '새 주제',
      expectedRevision: 1,
    });
    expect(tx.knowledgeTopic.updateMany).toHaveBeenCalledWith({
      where: { id: 'topic-1', userId: 'owner', revision: 1 },
      data: { ...normalizeTopicName('새 주제'), revision: { increment: 1 } },
    });
    expect(result.revision).toBe(2);
  });
  it('does not increment unchanged edits and rejects malformed revision values', async () => {
    const { service, tx } = setup();
    await service.updateTopic('owner', 'topic-1', {
      description: null,
      expectedRevision: 1,
    });
    expect(tx.knowledgeTopic.updateMany).not.toHaveBeenCalled();
    await expect(
      service.updateTopic('owner', 'topic-1', {
        description: 'new',
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateTopic('owner', 'topic-1', { expectedRevision: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('deletes only owner topics and never saved articles', async () => {
    const { service, tx } = setup();
    await expect(service.deleteTopic('owner', 'topic-1')).resolves.toEqual({
      deleted: true,
      id: 'topic-1',
    });
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(['topic-1', 'owner']);
    expect(tx.knowledgeTopic.delete).toHaveBeenCalledWith({
      where: { id: 'topic-1', userId: 'owner' },
    });
    expect(tx.savedArticle.delete).not.toHaveBeenCalled();
  });
  it('foreign/missing topic writes stop at the owner-scoped lock', async () => {
    const { service, tx } = setup();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'other' }])
      .mockResolvedValueOnce([]);
    await expect(
      service.deleteTopic('other', 'topic-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.knowledgeTopic.delete).not.toHaveBeenCalled();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'other' }])
      .mockResolvedValueOnce([]);
    await expect(
      service.updateTopic('other', 'topic-1', {
        name: 'x',
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.knowledgeTopic.updateMany).not.toHaveBeenCalled();
  });
  it('does not conceal CAS failures', async () => {
    const { service, tx } = setup();
    tx.knowledgeTopic.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.updateTopic('owner', 'topic-1', {
        description: 'new',
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('knowledge memberships', () => {
  it.each([
    [true, false, 1, 0, 1],
    [true, true, 0, 0, 0],
    [false, true, 0, 1, 1],
    [false, false, 0, 0, 0],
  ])(
    'link=%s existing=%s changes revision only once',
    async (linked, exists, creates, deletes, increments) => {
      const { service, tx } = setup();
      tx.topicArticle.findUnique.mockResolvedValue(
        exists ? { topicId: 'topic-1', articleId: 'article-1' } : null,
      );
      await service.setMembership('owner', 'topic-1', 'article-1', linked);
      expect(tx.topicArticle.create).toHaveBeenCalledTimes(creates);
      expect(tx.topicArticle.delete).toHaveBeenCalledTimes(deletes);
      expect(tx.knowledgeTopic.updateMany).toHaveBeenCalledTimes(increments);
      expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(['topic-1', 'owner']);
      expect(tx.$queryRaw.mock.calls[2].slice(1)).toEqual([
        'article-1',
        'owner',
      ]);
    },
  );
  it.each([true, false])(
    'rejects foreign articles for linked=%s before touching membership',
    async (linked) => {
      const { service, tx } = setup();
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: 'owner' }])
        .mockResolvedValueOnce([{ id: 'topic-1' }])
        .mockResolvedValueOnce([]);
      await expect(
        service.setMembership('owner', 'topic-1', 'foreign', linked),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.topicArticle.findUnique).not.toHaveBeenCalled();
      expect(tx.knowledgeTopic.updateMany).not.toHaveBeenCalled();
    },
  );
});

describe('knowledge paginated lists', () => {
  it('returns accurate counts and cursor advances stably by createdAt/id', async () => {
    const { service, tx } = setup();
    tx.knowledgeTopic.findMany
      .mockResolvedValueOnce([topic('3', 5, 2), topic('2'), topic('1')])
      .mockResolvedValueOnce([topic('1')]);
    const first = await service.listTopics('owner', { limit: 2 });
    expect(first.items.map((row) => row.id)).toEqual(['3', '2']);
    expect(first.items[0].articleCount).toBe(2);
    const second = await service.listTopics('owner', {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.nextCursor).toBeNull();
    expect(tx.knowledgeTopic.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { userId: 'owner' },
            {
              OR: [
                { createdAt: { lt: createdAt } },
                { createdAt, id: { lt: '2' } },
              ],
            },
          ],
        },
        take: 3,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });
  it('rejects modified cursors, different owners, searches and routes', async () => {
    const { service, tx } = setup();
    tx.knowledgeTopic.findMany.mockResolvedValue([topic('2'), topic('1')]);
    const { nextCursor } = await service.listTopics('owner', {
      limit: 1,
      search: 'AI',
    });
    for (const [owner, query] of [
      ['other', { cursor: nextCursor!, search: 'AI' }],
      ['owner', { cursor: nextCursor!, search: 'different' }],
      ['owner', { cursor: `${nextCursor!}invalid`, search: 'AI' }],
    ] as const)
      await expect(service.listTopics(owner, query)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    await expect(
      service.listArticleTopics('owner', 'article-1', {
        cursor: nextCursor!,
        search: 'AI',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listTopicArticles('owner', 'topic-1', {
        cursor: nextCursor!,
        search: 'AI',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.knowledgeTopic.findMany).toHaveBeenCalledTimes(1);
  });
  it.each([0, 101, 1.2, Number.NaN])(
    'rejects invalid page size %s',
    async (limit) => {
      const { service } = setup();
      await expect(
        service.listTopics('owner', { limit }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('limits article-topic results to both owned entities', async () => {
    const { service, tx } = setup();
    await service.listArticleTopics('owner', 'article-1', {});
    expect(tx.knowledgeTopic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { userId: 'owner' },
            {
              articles: {
                some: { articleId: 'article-1', article: { userId: 'owner' } },
              },
            },
          ],
        },
      }),
    );
  });
  it('returns light article metadata and owner-batched legacy preview, without source/summary/internal error', async () => {
    const { service, tx } = setup();
    tx.savedArticle.findMany
      .mockResolvedValueOnce([
        {
          id: 'article-1',
          savedAt: createdAt,
          summaryPreview: null,
          processStatus: 'SUMMARY_DONE',
          lastSummaryError: 'private diagnostic',
        },
        { id: 'article-2', savedAt: createdAt, summaryPreview: 'preview' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'article-1',
          summaryMeta: { summaryMarkdown: '# title\n내용 **핵심**' },
          summary: null,
        },
      ]);
    const result = await service.listTopicArticles('owner', 'topic-1', {
      limit: 1,
      search: 'AI',
    });
    expect(result.items[0].summaryPreview).toBe('내용 핵심');
    for (const field of [
      'rawText',
      'summary',
      'summaryMeta',
      'lastSummaryError',
    ])
      expect(result.items[0]).not.toHaveProperty(field);
    expect(tx.savedArticle.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: 'owner',
              topicArticles: {
                some: { topicId: 'topic-1', topic: { userId: 'owner' } },
              },
            },
            {
              OR: [
                { title: { contains: 'AI' } },
                { summary: { contains: 'AI' } },
                { url: { contains: 'AI' } },
              ],
            },
          ],
        },
        take: 2,
      }),
    );
    expect(tx.savedArticle.findMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'owner', id: { in: ['article-1'] } },
      select: { id: true, summaryMeta: true, summary: true },
    });
    await expect(
      service.listTopicArticles('owner', 'other-topic', {
        cursor: result.nextCursor!,
        search: 'AI',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
