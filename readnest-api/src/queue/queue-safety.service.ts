import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

// DB dispatchers refresh demand every 5 seconds while recoverable work exists.
// In particular, do not stop the stalled checker while an old Redis active job
// is waiting to be reclaimed, even when the worker emits `drained`.
export const WORKER_IDLE_MS = 15_000;

type ManagedWorker = {
  worker: Worker;
  active: Set<symbol>;
  demandUntil: number;
  version: number;
  timer?: ReturnType<typeof setTimeout>;
  sleeping?: Promise<void>;
};

export function isRedisQuotaError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /\bmax requests limit exceeded\b/i.test(error.message)
  );
}

/** Process-local latch, not a Redis-backed breaker: an exhausted DB cannot
 * reliably store the breaker itself. Restore capacity, then restart to recover.
 */
@Injectable()
export class QueueSafetyService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueSafetyService.name);
  private readonly workers = new Map<Worker, ManagedWorker>();
  private readonly demand = new Map<string, number>();
  private stopped = false;
  private shuttingDown = false;

  get isQuotaBlocked(): boolean {
    return this.stopped;
  }

  watchQueue(queue: Queue): void {
    queue.on('error', (error) => this.reportError(error));
  }

  startWorker(worker: Worker): void {
    if (this.workers.has(worker)) return;
    const state: ManagedWorker = {
      worker,
      active: new Set(),
      demandUntil: 0,
      version: 0,
    };
    this.workers.set(worker, state);
    const finished = () => this.armIdle(state);
    worker.on('completed', finished);
    worker.on('failed', finished);
    worker.on('drained', () => this.armIdle(state));
    worker.on('closed', () => {
      clearTimeout(state.timer);
      this.workers.delete(worker);
    });
    if (this.stopped || this.shuttingDown) {
      this.closeWorker(worker);
      return;
    }
    // Bootstrap only registers. A prior successful enqueue must not be lost.
    if (this.demand.has(worker.name)) this.wakeWorker(worker.name);
  }

  wakeWorker(queueName: string): void {
    if (this.stopped || this.shuttingDown) return;
    const until = Date.now() + WORKER_IDLE_MS;
    this.demand.set(queueName, until);
    for (const state of this.workers.values()) {
      if (state.worker.name !== queueName) continue;
      state.demandUntil = until;
      state.version++;
      // A wake while pause(false) awaits a prefetched job is replayed afterwards.
      if (!state.sleeping) this.ensureAwake(state);
      this.armIdle(state);
    }
  }

  async withProcessing<T>(
    queueName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    // BullMQ's completion-prefetch path does not emit `active`. Track processor
    // entry itself, otherwise an idle pause could park free concurrency until
    // a long prefetched job finishes. Finally cleanup does not depend on Redis
    // completion/failed events, which may be absent after a lost lock.
    const token = Symbol('processor');
    const states = [...this.workers.values()].filter(
      (state) => state.worker.name === queueName,
    );
    for (const state of states) state.active.add(token);
    try {
      return await operation();
    } finally {
      for (const state of states) {
        state.active.delete(token);
        this.armIdle(state);
      }
    }
  }

  async enqueue<T>(queueName: string, operation: () => Promise<T>): Promise<T> {
    if (this.stopped) throw new Error('REDIS_QUOTA_BLOCKED');
    if (this.shuttingDown) throw new Error('QUEUE_SHUTTING_DOWN');
    try {
      const result = await operation();
      // Also wake on deduplicated adds: durable DB work may need stalled recovery.
      this.wakeWorker(queueName);
      return result;
    } catch (error) {
      this.reportError(error);
      throw error;
    }
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    for (const state of this.workers.values()) clearTimeout(state.timer);
    // Nest owns graceful worker shutdown. No queued transition may resume it.
  }

  private ensureAwake(state: ManagedWorker): void {
    if (this.stopped || this.shuttingDown || !this.workers.has(state.worker))
      return;
    if (state.worker.isPaused()) {
      state.worker.resume();
    } else if (!state.worker.isRunning()) {
      // The processor error listener is attached by Nest before bootstrap.
      void state.worker
        .run()
        .catch((error: unknown) => this.reportError(error));
    }
  }

  private armIdle(state: ManagedWorker): void {
    clearTimeout(state.timer);
    if (
      this.stopped ||
      this.shuttingDown ||
      state.sleeping ||
      !this.workers.has(state.worker)
    )
      return;
    state.timer = setTimeout(
      () => {
        state.timer = undefined;
        // Keep active locks and available concurrency until local work finishes.
        // `drained` alone does NOT imply that all processors have finished.
        if (state.active.size || this.stopped || this.shuttingDown) return;
        const version = state.version;
        state.sleeping = state.worker
          .pause(false)
          .catch((error: unknown) => this.reportError(error))
          .finally(() => {
            state.sleeping = undefined;
            if (
              state.version !== version &&
              !this.stopped &&
              !this.shuttingDown
            ) {
              this.ensureAwake(state);
              this.armIdle(state);
            }
          });
      },
      Math.max(1, state.demandUntil - Date.now()),
    );
    state.timer.unref();
  }

  reportError(error: unknown): void {
    if (this.stopped) return;
    if (!isRedisQuotaError(error)) {
      // Never log Redis command arguments, credentials or article contents.
      this.logger.warn(
        'Queue operation failed; no Redis quota exhaustion detected.',
      );
      return;
    }
    this.stopped = true;
    this.logger.error(
      'REDIS_QUOTA_EXCEEDED: stopping workers and enqueue attempts in this process. ' +
        'Restore Redis capacity, then restart. Durable DB jobs are preserved.',
    );
    for (const state of this.workers.values()) {
      clearTimeout(state.timer);
      this.closeWorker(state.worker);
    }
  }

  private closeWorker(worker: Worker): void {
    // pause(true) alone still renews active locks. close(true) also stops lock
    // renewal and stalled checks. In-flight processors may finish their DB work;
    // durable leases/CAS/checkpoints handle delivery after capacity is restored.
    void worker.close(true).catch(() => {
      this.logger.error(
        'Failed to close a quota-blocked worker; restart required.',
      );
    });
  }
}
