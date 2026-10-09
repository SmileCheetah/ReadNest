/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { SummaryJobService } from './summary-job.service';
import { SummaryGenerationError } from './summary-errors';
import { QueueSafetyService } from '../queue/queue-safety.service';

function setup() {
  const tx = {
    savedArticle: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    summaryTask: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((fn: (transaction: typeof tx) => unknown) => fn(tx)),
  };
  const queue = { add: jest.fn().mockResolvedValue({}), on: jest.fn() };
  const service = new SummaryJobService(
    prisma as never,
    queue as never,
    new QueueSafetyService(),
  );
  const lease = {
    taskId: 'task',
    articleId: 'article',
    generation: 2,
    token: 'lease',
  };
  return { tx, prisma, queue, service, lease };
}

describe('durable summary ownership and recovery', () => {
  it('ignores an old-format job and deleted/stale generations', async () => {
    const s = setup();
    expect(await s.service.claim({ articleId: 'article' } as never)).toBeNull();
    s.tx.savedArticle.findFirst.mockResolvedValue(null);
    expect(
      await s.service.claim({
        articleId: 'article',
        generation: 1,
        taskId: 'old',
      }),
    ).toBeNull();
    expect(s.tx.summaryTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'old',
          articleId: 'article',
          generation: 1,
          state: 'PENDING',
        },
        data: expect.objectContaining({ state: 'FAILED' }),
      }),
    );
    expect(s.tx.savedArticle.updateMany).not.toHaveBeenCalled();
  });
  it('requires a live lease and current generation for success and failure writes', async () => {
    const s = setup();
    await s.service.complete(s.lease, { summary: 'new' });
    expect(s.tx.summaryTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leaseToken: 'lease',
          state: 'RUNNING',
          leaseExpiresAt: expect.any(Object),
        }),
      }),
    );
    expect(s.tx.savedArticle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'article', generation: 2 } }),
    );
    s.tx.summaryTask.updateMany.mockResolvedValue({ count: 0 });
    s.tx.savedArticle.updateMany.mockClear();
    expect(await s.service.complete(s.lease, {})).toBe(false);
    await s.service.fail(s.lease, new SummaryGenerationError('failed'), 1);
    expect(s.tx.savedArticle.updateMany).not.toHaveBeenCalled();
  });
  it('changes visible stage only while holding a live task lease', async () => {
    const s = setup();
    await s.service.stage(s.lease, 'GENERATING');
    expect(s.tx.savedArticle.updateMany).toHaveBeenCalledWith({
      where: { id: 'article', generation: 2 },
      data: { stage: 'GENERATING' },
    });
    s.tx.summaryTask.updateMany.mockResolvedValue({ count: 0 });
    s.tx.savedArticle.updateMany.mockClear();
    await expect(s.service.stage(s.lease, 'PERSISTING')).rejects.toMatchObject({
      code: 'STALE_JOB',
    });
    expect(s.tx.savedArticle.updateMany).not.toHaveBeenCalled();
  });
  it('records failed refresh status without overwriting the last useful document', async () => {
    const s = setup();
    await s.service.fail(
      s.lease,
      new SummaryGenerationError('invalid', 'INVALID_MARKDOWN', false),
      1,
    );
    const data = s.tx.savedArticle.updateMany.mock.calls[0][0].data;
    expect(data.processStatus).toBe('SUMMARY_FAILED');
    expect(data.summary).toBeUndefined();
    expect(data.summaryMeta).toBeUndefined();
    expect(data.resultGeneration).toBeUndefined();
    expect(s.tx.summaryTask.updateMany.mock.calls[0][0].data.state).toBe(
      'FAILED',
    );
  });
  it('durably schedules transient retry, preserving a saved checkpoint', async () => {
    const s = setup();
    await s.service.fail(
      s.lease,
      new SummaryGenerationError('rate limit', 'AI_RATE_LIMIT', true, 60),
      1,
    );
    const data = s.tx.summaryTask.updateMany.mock.calls[0][0].data;
    expect(data.state).toBe('PENDING');
    expect(data.notBefore.getTime()).toBeGreaterThan(Date.now() + 59000);
    expect(data.result).toBeUndefined();
  });
  it('limits dispatcher wait and does not accumulate offline Redis commands', async () => {
    jest.useFakeTimers();
    try {
      const s = setup();
      s.tx.summaryTask.findMany.mockImplementation(({ where }) =>
        Promise.resolve(
          where.state === 'PENDING'
            ? [{ id: 'task', articleId: 'article', generation: 1 }]
            : [],
        ),
      );
      s.queue.add.mockImplementation(() => new Promise(() => {}));
      const first = s.service.dispatch();
      await jest.advanceTimersByTimeAsync(3001);
      await first;
      const second = s.service.dispatch();
      await jest.advanceTimersByTimeAsync(3001);
      await second;
      expect(s.queue.add).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
