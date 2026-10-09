import { Logger } from '@nestjs/common';
import { SummaryJobService } from '../summary/summary-job.service';
import { SummaryVariantJobService } from '../summary/summary-variant-job.service';
import { QueueSafetyService } from './queue-safety.service';

describe.each(['summary', 'variant'] as const)(
  '%s durable dispatch quota protection',
  (kind) => {
    function setup() {
      const task = {
        id: 'task',
        articleId: 'article',
        variantId: 'variant',
        generation: 1,
        sourceGeneration: 1,
        state: 'PENDING',
        attempts: 0,
      };
      const tasks = {
        findMany: jest.fn(({ where }: { where: { state: string } }) =>
          Promise.resolve(where.state === 'PENDING' ? [task] : []),
        ),
        updateMany: jest.fn(),
      };
      const prisma = {
        summaryTask: tasks,
        summaryVariantTask: tasks,
        $transaction: jest.fn(),
      };
      const queue = { add: jest.fn().mockResolvedValue({}), on: jest.fn() };
      const safety = new QueueSafetyService();
      const service =
        kind === 'summary'
          ? new SummaryJobService(prisma as never, queue as never, safety)
          : new SummaryVariantJobService(
              prisma as never,
              queue as never,
              safety,
            );
      return { task, tasks, prisma, queue, safety, service };
    }

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    it('leaves durable PENDING records untouched and stops repeated enqueue attempts', async () => {
      const s = setup();
      s.queue.add.mockRejectedValue(
        new Error(
          'ERR max requests limit exceeded. Limit: 500000, Usage: 500004.',
        ),
      );
      await s.service.dispatch();
      await s.service.dispatch();
      expect(s.safety.isQuotaBlocked).toBe(true);
      expect(s.queue.add).toHaveBeenCalledTimes(1);
      expect(s.tasks.updateMany).not.toHaveBeenCalled();
      expect(s.prisma.$transaction).not.toHaveBeenCalled();
      expect(s.task.state).toBe('PENDING');
      expect(s.task.attempts).toBe(0);
    });

    it('detects quota rejection even after the dispatcher timeout has elapsed', async () => {
      jest.useFakeTimers();
      const s = setup();
      let rejectAdd!: (reason: Error) => void;
      s.queue.add.mockReturnValue(
        new Promise((_, reject) => {
          rejectAdd = reject;
        }),
      );
      const dispatch = s.service.dispatch();
      await jest.advanceTimersByTimeAsync(3001);
      await dispatch;
      expect(s.safety.isQuotaBlocked).toBe(false);
      rejectAdd(new Error('ERR max requests limit exceeded.'));
      await jest.advanceTimersByTimeAsync(0);
      expect(s.safety.isQuotaBlocked).toBe(true);
      await s.service.dispatch();
      expect(s.queue.add).toHaveBeenCalledTimes(1);
    });

    it('allows ordinary temporary errors to recover on the next dispatch', async () => {
      const s = setup();
      s.queue.add.mockRejectedValueOnce(new Error('ECONNRESET'));
      await s.service.dispatch();
      expect(s.safety.isQuotaBlocked).toBe(false);
      await s.service.dispatch();
      expect(s.queue.add).toHaveBeenCalledTimes(2);
    });
  },
);
