import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueSafetyService } from './queue-safety.service';

export const QUEUE_WORKER_OPTIONS = {
  // Blocking waits wake when a job arrives; this is not a 60-second job delay.
  drainDelay: 60,
  // Keep recovery enabled. A crashed worker's jobs can take longer to recover.
  stalledInterval: 120_000,
  // Register listeners at bootstrap, but start fetching only on DB-backed demand.
  autorun: false,
};

export abstract class QuotaAwareWorkerHost
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly queueSafety: QueueSafetyService,
    private readonly queueName: string,
  ) {
    super();
  }

  process(job: Job): Promise<void> {
    return this.queueSafety.withProcessing(this.queueName, () =>
      this.processJob(job),
    );
  }

  protected abstract processJob(job: Job): Promise<void>;

  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.queueSafety.reportError(error);
  }

  onApplicationBootstrap(): void {
    this.queueSafety.startWorker(this.worker);
  }
}
