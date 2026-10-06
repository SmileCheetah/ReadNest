import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  AutoConnectionsService,
  AUTO_CONNECTION_QUEUE,
  ConnectionJob,
} from './auto-connections.service';

@Processor(AUTO_CONNECTION_QUEUE, { concurrency: 1 })
export class AutoConnectionsProcessor extends WorkerHost {
  constructor(private readonly connections: AutoConnectionsService) {
    super();
  }

  async process(job: Job<ConnectionJob>) {
    await this.connections.process(job.data);
  }
}
