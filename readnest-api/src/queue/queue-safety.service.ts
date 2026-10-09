import { Injectable, Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

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
export class QueueSafetyService {
  private readonly logger = new Logger(QueueSafetyService.name);
  private readonly workers = new Set<Worker>();
  private stopped = false;

  get isQuotaBlocked(): boolean {
    return this.stopped;
  }

  watchQueue(queue: Queue): void {
    queue.on('error', (error) => this.reportError(error));
  }

  startWorker(worker: Worker): void {
    this.workers.add(worker);
    if (this.stopped) {
      this.closeWorker(worker);
      return;
    }
    // The processor error listener is attached by Nest before bootstrap.
    void worker.run().catch((error: unknown) => this.reportError(error));
  }

  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopped) throw new Error('REDIS_QUOTA_BLOCKED');
    try {
      return await operation();
    } catch (error) {
      this.reportError(error);
      throw error;
    }
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
    for (const worker of this.workers) this.closeWorker(worker);
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
