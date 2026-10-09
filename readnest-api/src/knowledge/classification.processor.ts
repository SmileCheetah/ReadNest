import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueSafetyService } from '../queue/queue-safety.service';
import {
  QUEUE_WORKER_OPTIONS,
  QuotaAwareWorkerHost,
} from '../queue/quota-aware-worker.host';
import {
  CLASSIFICATION_QUEUE,
  ClassificationJob,
  ClassificationService,
} from './classification.service';

@Processor(CLASSIFICATION_QUEUE, { ...QUEUE_WORKER_OPTIONS, concurrency: 1 })
export class ClassificationProcessor extends QuotaAwareWorkerHost {
  constructor(
    private readonly classification: ClassificationService,
    queueSafety: QueueSafetyService,
  ) {
    super(queueSafety);
  }
  async process(job: Job<ClassificationJob>) {
    await this.classification.process(job.data);
  }
}
