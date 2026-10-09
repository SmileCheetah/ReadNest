import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import {
  ClassificationService,
  CLASSIFICATION_QUEUE,
} from './classification.service';
import { ClassificationProcessor } from './classification.processor';

@Module({
  imports: [BullModule.registerQueue({ name: CLASSIFICATION_QUEUE })],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, ClassificationService, ClassificationProcessor],
  exports: [ClassificationService],
})
export class KnowledgeModule {}
