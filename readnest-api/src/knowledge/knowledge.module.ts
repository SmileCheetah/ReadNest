import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import {
  AutoConnectionsService,
  AUTO_CONNECTION_QUEUE,
} from './auto-connections.service';
import { AutoConnectionsProcessor } from './auto-connections.processor';

@Module({
  imports: [BullModule.registerQueue({ name: AUTO_CONNECTION_QUEUE })],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    AutoConnectionsService,
    AutoConnectionsProcessor,
  ],
  exports: [AutoConnectionsService],
})
export class KnowledgeModule {}
