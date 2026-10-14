import { Logger } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { EventEmitter } from 'node:events';
import {
  isRedisQuotaError,
  QueueSafetyService,
  WORKER_IDLE_MS,
} from './queue-safety.service';
import {
  QUEUE_WORKER_OPTIONS,
  QuotaAwareWorkerHost,
} from './quota-aware-worker.host';

const quotaError = () =>
  new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500004');

class FakeWorker extends EventEmitter {
  running = false;
  paused = false;
  readonly run = jest.fn(() => {
    this.running = true;
    return Promise.resolve();
  });
  readonly isRunning = jest.fn(() => this.running);
  readonly isPaused = jest.fn(() => this.paused);
  readonly pause = jest.fn<Promise<void>, [boolean?]>(() => {
    this.paused = true;
    this.running = false;
    return Promise.resolve();
  });
  readonly resume = jest.fn(() => {
    this.paused = false;
    this.running = true;
  });
  readonly close = jest
    .fn<Promise<void>, [boolean?]>()
    .mockResolvedValue(undefined);

  constructor(readonly name = 'summary') {
    super();
  }

  asWorker(): Worker {
    return this as unknown as Worker;
  }
}

class TestWorkerHost extends QuotaAwareWorkerHost {
  readonly execute = jest
    .fn<Promise<void>, [Job]>()
    .mockResolvedValue(undefined);

  constructor(
    safety: QueueSafetyService,
    private readonly fakeWorker: FakeWorker,
  ) {
    super(safety, fakeWorker.name);
  }

  override get worker(): Worker {
    return this.fakeWorker.asWorker();
  }

  protected processJob(job: Job): Promise<void> {
    return this.execute(job);
  }
}

function makeHost(safety: QueueSafetyService, queueName = 'summary') {
  const worker = new FakeWorker(queueName);
  const host = new TestWorkerHost(safety, worker);
  // Simulate Nest attaching the inherited @OnWorkerEvent listener before boot.
  worker.on('error', (error: Error) => host.onWorkerError(error));
  return { host, worker };
}

async function flushAsyncHandlers(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

describe('Redis quota safety', () => {
  let errorLog: jest.SpyInstance;
  let warningLog: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
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

  it('registers dormant workers at bootstrap and wakes only after a successful enqueue', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    const operation = jest.fn(() => Promise.resolve({ id: 'durable-task' }));

    expect(worker.run).not.toHaveBeenCalled();
    host.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(worker.run).not.toHaveBeenCalled();
    expect(worker.pause).not.toHaveBeenCalled();
    await expect(safety.enqueue('summary', operation)).resolves.toEqual({
      id: 'durable-task',
    });
    expect(worker.run).toHaveBeenCalledTimes(1);
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
    safety.wakeWorker('summary');
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

    await expect(safety.enqueue('summary', first)).rejects.toBe(error);
    await expect(safety.enqueue('variant', later)).rejects.toThrow(
      'REDIS_QUOTA_BLOCKED',
    );

    expect(first).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('handles synchronous enqueue exceptions as well as promise rejections', async () => {
    const safety = new QueueSafetyService();
    const error = quotaError();

    await expect(
      safety.enqueue('summary', () => {
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
    const enqueue = safety.enqueue('summary', () => operation);
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
    await expect(
      safety.enqueue('summary', () => Promise.reject(error)),
    ).rejects.toBe(error);
    await expect(
      safety.enqueue('summary', () => Promise.resolve('ok')),
    ).resolves.toBe('ok');

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
    safety.wakeWorker('summary');
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
    await expect(
      restarted.enqueue('summary', () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });

  it('remembers successful pre-bootstrap enqueue demand without waking unrelated queues', async () => {
    const safety = new QueueSafetyService();
    await safety.enqueue('summary', () => Promise.resolve('queued'));
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS * 2);
    const summary = makeHost(safety);
    const variant = makeHost(safety, 'variant');
    const classification = makeHost(safety, 'classification');

    summary.host.onApplicationBootstrap();
    variant.host.onApplicationBootstrap();
    classification.host.onApplicationBootstrap();

    expect(summary.worker.run).toHaveBeenCalledTimes(1);
    expect(variant.worker.run).not.toHaveBeenCalled();
    expect(classification.worker.run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    expect(summary.worker.pause).toHaveBeenCalledWith(false);
  });

  it('registers a worker only once even if bootstrap is invoked twice', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    host.onApplicationBootstrap();
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    safety.wakeWorker('summary');

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(worker.listenerCount('completed')).toBe(1);
    expect(worker.listenerCount('closed')).toBe(1);
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    expect(worker.pause).toHaveBeenCalledTimes(1);
  });

  it('sleeps gracefully after the idle grace period and resumes only the matching queue', async () => {
    const safety = new QueueSafetyService();
    const summary = makeHost(safety);
    const variant = makeHost(safety, 'variant');
    summary.host.onApplicationBootstrap();
    variant.host.onApplicationBootstrap();
    safety.wakeWorker('summary');

    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS - 1);
    expect(summary.worker.pause).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(summary.worker.pause).toHaveBeenCalledTimes(1);
    expect(summary.worker.pause).toHaveBeenCalledWith(false);
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(summary.worker.pause).toHaveBeenCalledTimes(1);
    expect(summary.worker.run).toHaveBeenCalledTimes(1);
    expect(summary.worker.resume).not.toHaveBeenCalled();
    expect(variant.worker.run).not.toHaveBeenCalled();

    await safety.enqueue('summary', () => Promise.resolve('new-task'));
    expect(summary.worker.resume).toHaveBeenCalledTimes(1);
    expect(variant.worker.run).not.toHaveBeenCalled();
    expect(variant.worker.resume).not.toHaveBeenCalled();
  });

  it('does not sleep on drained while local processors are still active', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    let firstComplete!: () => void;
    let secondComplete!: () => void;
    const first = safety.withProcessing(
      'summary',
      () =>
        new Promise<void>((resolve) => {
          firstComplete = resolve;
        }),
    );
    const second = safety.withProcessing(
      'summary',
      () =>
        new Promise<void>((resolve) => {
          secondComplete = resolve;
        }),
    );
    worker.emit('drained');

    await jest.advanceTimersByTimeAsync(2 * WORKER_IDLE_MS);
    expect(worker.pause).not.toHaveBeenCalled();
    firstComplete();
    await first;
    worker.emit('completed', { id: 'first' });
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.pause).not.toHaveBeenCalled();
    secondComplete();
    await second;
    worker.emit('failed', { id: 'second' }, new Error('job failed'));
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.pause).toHaveBeenCalledTimes(1);
    expect(worker.close).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed'])(
    'schedules idle sleep after an active job is %s',
    async (event) => {
      const safety = new QueueSafetyService();
      const { host, worker } = makeHost(safety);
      host.onApplicationBootstrap();
      safety.wakeWorker('summary');
      let complete!: () => void;
      const processing = safety.withProcessing(
        'summary',
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      );
      await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
      expect(worker.pause).not.toHaveBeenCalled();

      complete();
      await processing;
      worker.emit(event, { id: 'task' });
      await jest.advanceTimersByTimeAsync(1);
      expect(worker.pause).toHaveBeenCalledWith(false);
    },
  );

  it('keeps stalled recovery awake while DB dispatch refreshes demand even beyond the stalled interval', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    worker.emit('drained');

    // An already-active Redis job can deduplicate each DB outbox enqueue while
    // waiting for its lock to expire and the stalled checker to recover it.
    for (
      let elapsed = 0;
      elapsed < 2 * QUEUE_WORKER_OPTIONS.stalledInterval;
      elapsed += 5000
    ) {
      await jest.advanceTimersByTimeAsync(5000);
      safety.wakeWorker('summary');
    }

    expect(worker.pause).not.toHaveBeenCalled();
    expect(worker.run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    expect(worker.pause).toHaveBeenCalledTimes(1);
  });

  it('wakes on a successful deduplicated add without depending on a new job result', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    const sameJob = { id: 'existing-durable-job' };
    host.onApplicationBootstrap();
    await safety.enqueue('summary', () => Promise.resolve(sameJob));
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    expect(worker.pause).toHaveBeenCalledTimes(1);

    await expect(
      safety.enqueue('summary', () => Promise.resolve(sameJob)),
    ).resolves.toBe(sameJob);
    expect(worker.resume).toHaveBeenCalledTimes(1);
  });

  it('replays demand received while graceful pause is still finishing', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    let finishPause!: () => void;
    worker.pause.mockImplementationOnce(() => {
      worker.paused = true;
      return new Promise<void>((resolve) => {
        finishPause = resolve;
      });
    });
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    expect(worker.pause).toHaveBeenCalledTimes(1);

    await safety.enqueue('summary', () => Promise.resolve('during-pause'));
    safety.wakeWorker('summary');
    expect(worker.resume).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    finishPause();
    await flushAsyncHandlers();
    expect(worker.resume).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS - 1001);
    expect(worker.pause).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.pause).toHaveBeenCalledTimes(2);
  });

  it.each(['quota', 'shutdown'] as const)(
    'never resumes a pending pause after %s',
    async (stop) => {
      const safety = new QueueSafetyService();
      const { host, worker } = makeHost(safety);
      let finishPause!: () => void;
      worker.pause.mockImplementationOnce(() => {
        worker.paused = true;
        return new Promise<void>((resolve) => {
          finishPause = resolve;
        });
      });
      host.onApplicationBootstrap();
      safety.wakeWorker('summary');
      await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
      safety.wakeWorker('summary');
      if (stop === 'quota') safety.reportError(quotaError());
      else safety.onModuleDestroy();
      finishPause();
      await flushAsyncHandlers();
      safety.wakeWorker('summary');
      await jest.advanceTimersByTimeAsync(2 * WORKER_IDLE_MS);

      expect(worker.resume).not.toHaveBeenCalled();
      expect(worker.run).toHaveBeenCalledTimes(1);
      expect(worker.pause).toHaveBeenCalledTimes(1);
      const operation = jest.fn(() => Promise.resolve('blocked'));
      await expect(safety.enqueue('summary', operation)).rejects.toThrow(
        stop === 'quota' ? 'REDIS_QUOTA_BLOCKED' : 'QUEUE_SHUTTING_DOWN',
      );
      expect(operation).not.toHaveBeenCalled();
    },
  );

  it('does not wake after an enqueue that completes during shutdown', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    let finishEnqueue!: () => void;
    host.onApplicationBootstrap();
    const pending = safety.enqueue(
      'summary',
      () =>
        new Promise<void>((resolve) => {
          finishEnqueue = resolve;
        }),
    );
    safety.onModuleDestroy();
    finishEnqueue();
    await pending;
    expect(worker.run).not.toHaveBeenCalled();
  });

  it('retries a non-quota run failure on the next demand signal', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    worker.run.mockRejectedValueOnce(
      new Error('connection temporarily unavailable'),
    );
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    await flushAsyncHandlers();
    expect(safety.isQuotaBlocked).toBe(false);
    safety.wakeWorker('summary');
    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(worker.running).toBe(true);
    expect(worker.close).not.toHaveBeenCalled();
  });

  it('tracks inherited processor execution even when a prefetched job emits no active event', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    const process = jest.spyOn(safety, 'withProcessing');
    let complete!: () => void;
    host.execute.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    const job = { id: 'prefetched-task' } as Job;
    const processing = host.process(job);
    worker.emit('drained');

    await jest.advanceTimersByTimeAsync(2 * WORKER_IDLE_MS);
    expect(process).toHaveBeenCalledWith('summary', expect.any(Function));
    expect(host.execute).toHaveBeenCalledWith(job);
    expect(worker.pause).not.toHaveBeenCalled();
    complete();
    await processing;
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.pause).toHaveBeenCalledWith(false);
  });

  it('cleans up processor activity after an asynchronous failure without hiding that failure', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    let fail!: (error: Error) => void;
    const processing = safety.withProcessing(
      'summary',
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const error = new Error('processor failed');
    const assertion = expect(processing).rejects.toBe(error);

    await jest.advanceTimersByTimeAsync(2 * WORKER_IDLE_MS);
    expect(worker.pause).not.toHaveBeenCalled();
    fail(error);
    await assertion;
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.pause).toHaveBeenCalledTimes(1);
    expect(safety.isQuotaBlocked).toBe(false);
  });

  it('keeps overlapping processor invocations active until each one finishes', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    let firstComplete!: () => void;
    let secondComplete!: () => void;
    const first = safety.withProcessing(
      'summary',
      () =>
        new Promise<void>((resolve) => {
          firstComplete = resolve;
        }),
    );
    const second = safety.withProcessing(
      'summary',
      () =>
        new Promise<void>((resolve) => {
          secondComplete = resolve;
        }),
    );

    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    firstComplete();
    await first;
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.pause).not.toHaveBeenCalled();
    secondComplete();
    await second;
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.pause).toHaveBeenCalledTimes(1);
  });

  it('does not let one queue processor keep an unrelated queue awake', async () => {
    const safety = new QueueSafetyService();
    const summary = makeHost(safety);
    const variant = makeHost(safety, 'variant');
    summary.host.onApplicationBootstrap();
    variant.host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    safety.wakeWorker('variant');
    let complete!: () => void;
    const processing = safety.withProcessing(
      'summary',
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    expect(summary.worker.pause).not.toHaveBeenCalled();
    expect(variant.worker.pause).toHaveBeenCalledTimes(1);
    complete();
    await processing;
  });

  it.each(['quota', 'shutdown'] as const)(
    'finishing an in-flight processor after %s cannot restart its worker',
    async (stop) => {
      const safety = new QueueSafetyService();
      const { host, worker } = makeHost(safety);
      host.onApplicationBootstrap();
      safety.wakeWorker('summary');
      let complete!: () => void;
      const processing = safety.withProcessing(
        'summary',
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      );
      await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
      if (stop === 'quota') safety.reportError(quotaError());
      else safety.onModuleDestroy();
      complete();
      await processing;
      await jest.advanceTimersByTimeAsync(2 * WORKER_IDLE_MS);

      expect(worker.pause).not.toHaveBeenCalled();
      expect(worker.resume).not.toHaveBeenCalled();
      expect(worker.run).toHaveBeenCalledTimes(1);
      expect(worker.close).toHaveBeenCalledTimes(stop === 'quota' ? 1 : 0);
    },
  );

  it('can sleep after a lost-lock Redis completion error without completed or failed events', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    let complete!: () => void;
    host.execute.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    const job = { id: 'lost-lock-task' } as Job;
    worker.emit('active', job);
    const processing = host.process(job);
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    expect(worker.pause).not.toHaveBeenCalled();

    complete();
    await processing;
    // BullMQ may emit only `error` if its Redis completion/failure commands
    // cannot find the lock. An old active-event ID must not leak indefinitely.
    worker.emit('error', new Error('Missing lock for job lost-lock-task'));
    await jest.advanceTimersByTimeAsync(1);
    expect(worker.pause).toHaveBeenCalledTimes(1);
    expect(safety.isQuotaBlocked).toBe(false);
  });

  it('cannot resume or arm idle timers for a closed worker after late processor completion', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    let complete!: () => void;
    const processing = safety.withProcessing(
      'summary',
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    worker.paused = true;
    worker.running = false;
    worker.emit('closed');
    complete();
    await processing;
    worker.emit('completed', { id: 'late-task' });
    safety.wakeWorker('summary');
    await jest.advanceTimersByTimeAsync(2 * WORKER_IDLE_MS);

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(worker.resume).not.toHaveBeenCalled();
    expect(worker.pause).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cannot replay pending wake after a worker closes during graceful pause', async () => {
    const safety = new QueueSafetyService();
    const { host, worker } = makeHost(safety);
    let finishPause!: () => void;
    worker.pause.mockImplementationOnce(() => {
      worker.paused = true;
      return new Promise<void>((resolve) => {
        finishPause = resolve;
      });
    });
    host.onApplicationBootstrap();
    safety.wakeWorker('summary');
    await jest.advanceTimersByTimeAsync(WORKER_IDLE_MS);
    safety.wakeWorker('summary');
    worker.emit('closed');
    finishPause();
    await flushAsyncHandlers();
    safety.wakeWorker('summary');
    await jest.advanceTimersByTimeAsync(2 * WORKER_IDLE_MS);

    expect(worker.resume).not.toHaveBeenCalled();
    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(worker.pause).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
