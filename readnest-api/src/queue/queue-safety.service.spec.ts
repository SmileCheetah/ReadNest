import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { EventEmitter } from 'node:events';
import { isRedisQuotaError, QueueSafetyService } from './queue-safety.service';
import {
  QUEUE_WORKER_OPTIONS,
  QuotaAwareWorkerHost,
} from './quota-aware-worker.host';

const quotaError = () =>
  new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500004');

class FakeWorker extends EventEmitter {
  readonly run = jest.fn(() => Promise.resolve());
  readonly close = jest
    .fn<Promise<void>, [boolean?]>()
    .mockResolvedValue(undefined);

  asWorker(): Worker {
    return this as unknown as Worker;
  }
}

class TestWorkerHost extends QuotaAwareWorkerHost {
  constructor(
    safety: QueueSafetyService,
    private readonly fakeWorker: FakeWorker,
  ) {
    super(safety);
  }

  override get worker(): Worker {
    return this.fakeWorker.asWorker();
  }

  process(): Promise<void> {
    return Promise.resolve();
  }
}

function makeHost(safety: QueueSafetyService) {
  const worker = new FakeWorker();
  const host = new TestWorkerHost(safety, worker);
  // Simulate Nest attaching the inherited @OnWorkerEvent listener before boot.
  worker.on('error', (error: Error) => host.onWorkerError(error));
  return { host, worker };
}

async function flushAsyncHandlers(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('Redis quota safety', () => {
  let errorLog: jest.SpyInstance;
  let warningLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warningLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('recognizes the Redis quota message without classifying unrelated failures as quota', () => {
    expect(isRedisQuotaError(quotaError())).toBe(true);
    expect(
      isRedisQuotaError(new Error('ERR MAX REQUESTS LIMIT EXCEEDED.')),
    ).toBe(true);
    for (const error of [
      new Error('ECONNREFUSED'),
      new Error('QUEUE_TIMEOUT'),
      new Error('429 AI rate limit exceeded'),
      new Error('max memory limit exceeded'),
      { message: 'ERR max requests limit exceeded' },
      null,
      undefined,
    ]) {
      expect(isRedisQuotaError(error)).toBe(false);
    }
  });

  it('keeps automatic worker startup disabled and normal lock recovery enabled', () => {
    expect(QUEUE_WORKER_OPTIONS).toEqual({
      autorun: false,
      drainDelay: 60,
      stalledInterval: 120_000,
    });
    expect(QUEUE_WORKER_OPTIONS).not.toHaveProperty('skipLockRenewal');
    expect(QUEUE_WORKER_OPTIONS).not.toHaveProperty('skipStalledCheck');
    expect(QUEUE_WORKER_OPTIONS).not.toHaveProperty('lockDuration');
  });

  it('starts a worker only at application bootstrap and lets normal enqueues complete', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    const operation = jest.fn(() => Promise.resolve({ id: 'durable-task' }));

    expect(worker.run).not.toHaveBeenCalled();
    host.onApplicationBootstrap();

    expect(worker.run).toHaveBeenCalledTimes(1);
    await expect(safety.enqueue(operation)).resolves.toEqual({
      id: 'durable-task',
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(safety.isQuotaBlocked).toBe(false);
    expect(worker.close).not.toHaveBeenCalled();
  });

  it('closes all registered workers once when any worker reports quota exhaustion', () => {
    const safety = new QueueSafetyService();
    const workers = Array.from({ length: 3 }, () => makeHost(safety));
    for (const { host } of workers) host.onApplicationBootstrap();

    workers[0].worker.emit('error', quotaError());
    workers[1].worker.emit('error', quotaError());
    safety.reportError(quotaError());

    expect(safety.isQuotaBlocked).toBe(true);
    for (const { worker } of workers) {
      expect(worker.close).toHaveBeenCalledTimes(1);
      expect(worker.close).toHaveBeenCalledWith(true);
    }
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('REDIS_QUOTA_EXCEEDED'),
    );
  });

  it('closes a worker registered after quota failure without running it', () => {
    const safety = new QueueSafetyService();
    safety.reportError(quotaError());
    const { host, worker } = makeHost(safety);

    host.onApplicationBootstrap();

    expect(worker.run).not.toHaveBeenCalled();
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(worker.close).toHaveBeenCalledWith(true);
  });

  it('handles an inherited worker error before application bootstrap', () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    worker.emit('error', quotaError());

    host.onApplicationBootstrap();

    expect(safety.isQuotaBlocked).toBe(true);
    expect(worker.run).not.toHaveBeenCalled();
    expect(worker.close).toHaveBeenCalledWith(true);
  });

  it('catches a rejected worker run and trips the same shared guard', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    worker.run.mockRejectedValue(quotaError());

    host.onApplicationBootstrap();
    await flushAsyncHandlers();

    expect(safety.isQuotaBlocked).toBe(true);
    expect(worker.close).toHaveBeenCalledTimes(1);
  });

  it('observes producer queue error events without requiring a worker to run', () => {
    const safety = new QueueSafetyService();
    const queue = new EventEmitter();
    safety.watchQueue(queue as unknown as Queue);

    queue.emit('error', quotaError());

    expect(safety.isQuotaBlocked).toBe(true);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original enqueue quota error and blocks later operations locally', async () => {
    const safety = new QueueSafetyService();
    const error = quotaError();
    const first = jest.fn(() => Promise.reject(error));
    const later = jest.fn(() => Promise.resolve('must-not-enqueue'));

    await expect(safety.enqueue(first)).rejects.toBe(error);
    await expect(safety.enqueue(later)).rejects.toThrow('REDIS_QUOTA_BLOCKED');

    expect(first).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('handles synchronous enqueue exceptions as well as promise rejections', async () => {
    const safety = new QueueSafetyService();
    const error = quotaError();

    await expect(
      safety.enqueue(() => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(safety.isQuotaBlocked).toBe(true);
  });

  it('trips on a late enqueue rejection even after the dispatcher timeout wins', async () => {
    jest.useFakeTimers();
    const safety = new QueueSafetyService();
    let rejectEnqueue!: (error: Error) => void;
    const operation = new Promise<void>((_resolve, reject) => {
      rejectEnqueue = reject;
    });
    const enqueue = safety.enqueue(() => operation);
    const dispatcherWait = Promise.race([
      enqueue,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('QUEUE_TIMEOUT')), 3000);
      }),
    ]);
    const timeoutAssertion =
      expect(dispatcherWait).rejects.toThrow('QUEUE_TIMEOUT');

    await jest.advanceTimersByTimeAsync(3000);
    await timeoutAssertion;
    expect(safety.isQuotaBlocked).toBe(false);

    rejectEnqueue(quotaError());
    await jest.advanceTimersByTimeAsync(0);

    expect(safety.isQuotaBlocked).toBe(true);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('does not permanently stop workers or expose error payloads on ordinary failures', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    host.onApplicationBootstrap();
    const error = new Error('ECONNRESET private-command-payload');

    worker.emit('error', error);
    await expect(safety.enqueue(() => Promise.reject(error))).rejects.toBe(
      error,
    );
    await expect(safety.enqueue(() => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );

    expect(safety.isQuotaBlocked).toBe(false);
    expect(worker.close).not.toHaveBeenCalled();
    expect(warningLog).toHaveBeenCalledTimes(2);
    expect(warningLog.mock.calls.flat().join(' ')).not.toContain(
      'private-command-payload',
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('handles a non-quota run rejection without opening the permanent quota latch', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    worker.run.mockRejectedValue(new Error('Redis connection unavailable'));

    host.onApplicationBootstrap();
    await flushAsyncHandlers();

    expect(safety.isQuotaBlocked).toBe(false);
    expect(worker.close).not.toHaveBeenCalled();
    expect(warningLog).toHaveBeenCalledTimes(1);
  });

  it('handles a close rejection and still closes the other workers', async () => {
    const safety = new QueueSafetyService();
    const first = makeHost(safety);
    const second = makeHost(safety);
    first.worker.close.mockRejectedValue(
      new Error('private-close-error-details'),
    );
    first.host.onApplicationBootstrap();
    second.host.onApplicationBootstrap();

    first.worker.emit('error', quotaError());
    await flushAsyncHandlers();

    expect(safety.isQuotaBlocked).toBe(true);
    expect(first.worker.close).toHaveBeenCalledTimes(1);
    expect(second.worker.close).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      'Failed to close a quota-blocked worker; restart required.',
    );
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain(
      'private-close-error-details',
    );
  });

  it('keeps the latch closed over time but starts unblocked in a fresh process service', async () => {
    jest.useFakeTimers();
    const blocked = new QueueSafetyService();
    blocked.reportError(quotaError());

    await jest.advanceTimersByTimeAsync(24 * 60 * 60_000);

    expect(blocked.isQuotaBlocked).toBe(true);
    const restarted = new QueueSafetyService();
    expect(restarted.isQuotaBlocked).toBe(false);
    await expect(restarted.enqueue(() => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );
  });
});
