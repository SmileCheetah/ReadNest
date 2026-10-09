import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  CLASSIFICATION_QUEUE,
  ClassificationJob,
  ClassificationService,
} from './classification.service';

@Processor(CLASSIFICATION_QUEUE, { concurrency: 1 })
export class ClassificationProcessor extends WorkerHost {
  constructor(private readonly classification: ClassificationService) {
    super();
  }
  async process(job: Job<ClassificationJob>) {
    await this.classification.process(job.data);
  }
}
