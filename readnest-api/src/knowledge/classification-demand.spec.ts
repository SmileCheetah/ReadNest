/* Minimal persistence fakes exercise dispatch boundaries without Redis or AI. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Logger } from '@nestjs/common';
import { QueueSafetyService } from '../queue/queue-safety.service';
import {
  CLASSIFICATION_QUEUE,
  ClassificationService,
} from './classification.service';

function setup() {
  const classification = {
    articleId: 'article',
    sourceGeneration: 2,
    revision: 3,
    userEdited: false,
    state: 'PENDING',
    leaseToken: null,
  };
  const article = {
    id: 'article',
    rawText: '요약에 사용한 수집 원문',
    resultGeneration: 2,
    processStatus: 'SUMMARY_DONE',
    classification,
  };
  const prisma = {
    savedArticle: {
      findUnique: jest.fn().mockResolvedValue(article),
      findMany: jest.fn().mockResolvedValue([]),
    },
    articleClassification: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(classification),
      create: jest.fn().mockResolvedValue(classification),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const queue = {
    add: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const safety = new QueueSafetyService();
  const service = new ClassificationService(
    prisma as never,
    { get: () => undefined } as never,
    queue as never,
    safety,
  );
  return { prisma, queue, safety, service, article, classification };
}

function pendingDemand(s: ReturnType<typeof setup>): void {
  s.prisma.articleClassification.findMany.mockImplementation(
    ({ where }: { where: { state: string } }) =>
      Promise.resolve(
        where.state === 'PENDING' ? [{ articleId: 'article' }] : [],
      ),
  );
}

describe('classification durable demand recovery', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('polls an empty DB without contacting Redis and stops its timer on shutdown', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.prisma.savedArticle.findMany).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(s.prisma.savedArticle.findMany).toHaveBeenCalledTimes(2);
    expect(s.queue.add).not.toHaveBeenCalled();
    s.service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10_000);
    await s.service.dispatch();
    expect(s.prisma.savedArticle.findMany).toHaveBeenCalledTimes(2);
    expect(s.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('redelivers existing PENDING work with stable IDs and matching worker demand', async () => {
    const s = setup();
    const enqueue = jest.spyOn(s.safety, 'enqueue');
    pendingDemand(s);
    await s.service.dispatch();
    await s.service.dispatch();
    expect(s.queue.add).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      CLASSIFICATION_QUEUE,
      expect.any(Function),
    );
    expect(s.queue.add).toHaveBeenLastCalledWith(
      'classify',
      { articleId: 'article', sourceGeneration: 2, revision: 3 },
      expect.objectContaining({ jobId: 'article-3', attempts: 1 }),
    );
    expect(s.prisma.articleClassification.updateMany).not.toHaveBeenCalled();
  });

  it('creates missing classification demand after summary completion during an outage', async () => {
    const s = setup();
    s.prisma.savedArticle.findMany.mockResolvedValue([
      { ...s.article, classification: null },
    ]);
    s.prisma.savedArticle.findUnique.mockResolvedValue({
      ...s.article,
      classification: null,
    });
    await s.service.dispatch();
    expect(s.prisma.articleClassification.create).toHaveBeenCalledWith({
      data: { articleId: 'article', sourceGeneration: 2, categories: [] },
    });
    expect(s.queue.add).toHaveBeenCalledTimes(1);
  });

  it('updates outdated source demand but does not automatically retry a normal failure', async () => {
    const s = setup();
    s.prisma.savedArticle.findMany.mockResolvedValue([
      {
        ...s.article,
        classification: { ...s.classification, sourceGeneration: 1 },
      },
    ]);
    s.prisma.savedArticle.findUnique.mockResolvedValue({
      ...s.article,
      classification: { ...s.classification, sourceGeneration: 1 },
    });
    await s.service.dispatch();
    expect(s.prisma.articleClassification.updateMany).toHaveBeenCalledWith({
      where: { articleId: 'article', revision: 3, userEdited: false },
      data: expect.objectContaining({
        sourceGeneration: 2,
        state: 'PENDING',
        revision: { increment: 1 },
      }),
    });
    expect(s.queue.add).toHaveBeenCalledTimes(1);

    s.prisma.savedArticle.findUnique.mockResolvedValue({
      ...s.article,
      classification: { ...s.classification, state: 'FAILED' },
    });
    s.prisma.articleClassification.findUnique.mockResolvedValue({
      ...s.classification,
      state: 'FAILED',
    });
    s.prisma.savedArticle.findMany.mockResolvedValue([
      {
        ...s.article,
        classification: { ...s.classification, state: 'FAILED' },
      },
    ]);
    await s.service.dispatch();
    expect(s.queue.add).toHaveBeenCalledTimes(1);
    expect(s.prisma.articleClassification.updateMany).toHaveBeenCalledTimes(1);
  });

  it('pages the primary key without loading bodies and wraps after the last page', async () => {
    const s = setup();
    s.prisma.savedArticle.findMany.mockResolvedValueOnce(
      Array.from({ length: 50 }, (_, index) => ({
        ...s.article,
        id: `article-${index}`,
      })),
    );
    await s.service.dispatch();
    await s.service.dispatch();
    await s.service.dispatch();
    expect(s.prisma.savedArticle.findMany).toHaveBeenNthCalledWith(1, {
      where: {},
      orderBy: { id: 'asc' },
      take: 50,
      select: {
        id: true,
        resultGeneration: true,
        processStatus: true,
        classification: {
          select: { userEdited: true, state: true, sourceGeneration: true },
        },
      },
    });
    expect(s.prisma.savedArticle.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: { gt: 'article-49' } } }),
    );
    expect(s.prisma.savedArticle.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ where: {} }),
    );
    expect(s.prisma.articleClassification.findMany).toHaveBeenCalledWith({
      where: {
        state: 'PENDING',
        userEdited: false,
        article: {
          processStatus: { in: ['SUMMARY_DONE', 'CONTEXT_INSUFFICIENT'] },
          resultGeneration: { not: null },
          AND: [{ rawText: { not: null } }, { rawText: { not: '' } }],
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { articleId: 'asc' }],
      take: 50,
      select: { articleId: true },
    });
    expect(s.queue.add).not.toHaveBeenCalled();
    expect(s.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('filters ineligible old pending rows before the batch limit so newer work can run', async () => {
    const s = setup();
    const blocked = Array.from({ length: 50 }, (_, index) => ({
      articleId: `failed-summary-${index}`,
    }));
    s.prisma.articleClassification.findMany.mockImplementation(
      ({ where }: { where: { state: string; article?: unknown } }) =>
        Promise.resolve(
          where.state !== 'PENDING'
            ? []
            : where.article
              ? [{ articleId: 'healthy' }]
              : blocked,
        ),
    );
    s.prisma.savedArticle.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          ...s.article,
          id: where.id,
          processStatus:
            where.id === 'healthy' ? 'SUMMARY_DONE' : 'SUMMARY_FAILED',
        }),
    );
    await s.service.dispatch();
    expect(s.queue.add).toHaveBeenCalledTimes(1);
    expect(s.queue.add).toHaveBeenCalledWith(
      'classify',
      expect.objectContaining({ articleId: 'healthy' }),
      expect.any(Object),
    );
    expect(s.prisma.savedArticle.findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not double-enqueue a pending article also seen in the backfill page', async () => {
    const s = setup();
    pendingDemand(s);
    s.prisma.savedArticle.findMany.mockResolvedValue([
      {
        ...s.article,
        classification: { ...s.classification, sourceGeneration: 1 },
      },
    ]);
    await s.service.dispatch();
    expect(s.queue.add).toHaveBeenCalledTimes(1);
  });

  it('skips manual edits, current classifications and unfinished articles before reading bodies', async () => {
    const s = setup();
    s.prisma.savedArticle.findMany.mockResolvedValue([
      {
        ...s.article,
        id: 'manual',
        classification: {
          ...s.classification,
          userEdited: true,
          sourceGeneration: 1,
        },
      },
      {
        ...s.article,
        id: 'failed',
        classification: { ...s.classification, state: 'FAILED' },
      },
      { ...s.article, id: 'pending' },
      {
        ...s.article,
        id: 'unfinished',
        processStatus: 'SUMMARIZING',
        classification: null,
      },
      {
        ...s.article,
        id: 'no-source',
        resultGeneration: null,
        classification: null,
      },
      { ...s.article, id: 'empty-source', classification: null },
    ]);
    s.prisma.savedArticle.findUnique.mockResolvedValue({
      ...s.article,
      rawText: '  \n ',
      classification: null,
    });
    await s.service.dispatch();
    expect(s.prisma.savedArticle.findUnique).toHaveBeenCalledTimes(1);
    expect(s.prisma.savedArticle.findUnique).toHaveBeenCalledWith({
      where: { id: 'empty-source' },
      include: { classification: true },
    });
    expect(s.queue.add).not.toHaveBeenCalled();
  });

  it('reclaims stale RUNNING rows with revision, token and deadline guards', async () => {
    const s = setup();
    s.prisma.articleClassification.findMany.mockImplementation(
      ({ where }: { where: { state: string } }) =>
        Promise.resolve(
          where.state === 'RUNNING'
            ? [
                {
                  ...s.classification,
                  state: 'RUNNING',
                  leaseToken: 'expired-lease',
                },
              ]
            : [],
        ),
    );
    await s.service.dispatch();
    expect(s.prisma.articleClassification.findMany).toHaveBeenCalledWith({
      where: {
        userEdited: false,
        state: 'RUNNING',
        updatedAt: { lt: expect.any(Date) },
      },
      orderBy: [{ updatedAt: 'asc' }, { articleId: 'asc' }],
      take: 50,
    });
    expect(s.prisma.articleClassification.updateMany).toHaveBeenCalledWith({
      where: {
        articleId: 'article',
        sourceGeneration: 2,
        revision: 3,
        leaseToken: 'expired-lease',
        userEdited: false,
        state: 'RUNNING',
        updatedAt: { lt: expect.any(Date) },
      },
      data: {
        state: 'PENDING',
        leaseToken: null,
        revision: { increment: 1 },
      },
    });
  });

  it('preserves owner scope when an explicit user scan reclaims stale work', async () => {
    const s = setup();
    await expect(s.service.scan('owner')).resolves.toEqual({
      queued: 0,
      more: false,
      pending: false,
    });
    expect(s.prisma.articleClassification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ article: { userId: 'owner' } }),
      }),
    );
  });

  it('does not overlap scans or enqueue after shutdown during a DB request', async () => {
    const s = setup();
    let finish!: (value: Array<{ id: string }>) => void;
    s.prisma.savedArticle.findMany.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = s.service.dispatch();
    await s.service.dispatch();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.prisma.savedArticle.findMany).toHaveBeenCalledTimes(1);
    s.service.onModuleDestroy();
    finish([{ id: 'article' }]);
    await first;
    expect(s.queue.add).not.toHaveBeenCalled();
  });

  it('keeps one hanging enqueue across polls and catches a late quota rejection', async () => {
    jest.useFakeTimers();
    const s = setup();
    pendingDemand(s);
    let fail!: (error: Error) => void;
    s.queue.add.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    let dispatch = s.service.dispatch();
    await jest.advanceTimersByTimeAsync(3001);
    await dispatch;
    dispatch = s.service.dispatch();
    await jest.advanceTimersByTimeAsync(3001);
    await dispatch;
    expect(s.queue.add).toHaveBeenCalledTimes(1);
    fail(new Error('ERR max requests limit exceeded.'));
    await jest.advanceTimersByTimeAsync(0);
    expect(s.safety.isQuotaBlocked).toBe(true);
    await s.service.dispatch();
    expect(s.prisma.articleClassification.findMany).toHaveBeenCalledTimes(4);
    expect(s.prisma.savedArticle.findMany).not.toHaveBeenCalled();
    expect(s.prisma.articleClassification.updateMany).not.toHaveBeenCalled();
  });
});
