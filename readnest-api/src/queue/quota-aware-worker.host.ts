import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { OnApplicationBootstrap } from '@nestjs/common';
import { QueueSafetyService } from './queue-safety.service';

export const QUEUE_WORKER_OPTIONS = {
  // Blocking waits wake when a job arrives; this is not a 60-second job delay.
  drainDelay: 60,
  // Keep recovery enabled. A crashed worker's jobs can take longer to recover.
  stalledInterval: 120_000,
  // Register all safety listeners before starting the fetch loop.
  autorun: false,
};

export abstract class QuotaAwareWorkerHost
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(private readonly queueSafety: QueueSafetyService) {
    super();
  }

  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.queueSafety.reportError(error);
  }

  onApplicationBootstrap(): void {
    this.queueSafety.startWorker(this.worker);
  }
}
