import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SUMMARY_QUEUE } from './summary.constants';
import { AiSummaryService } from './ai-summary.service';
import { ContentExtractorService } from './content-extractor.service';
import { SummaryController } from './summary.controller';
import { SummaryProcessor } from './summary.processor';
import { SummaryService } from './summary.service';
import { ThreadDetectionService } from './thread-detection.service';
import { SummaryJobService } from './summary-job.service';
import { SUMMARY_VARIANT_QUEUE } from './summary.constants';
import { SummaryVariantJobService } from './summary-variant-job.service';
import { SummaryVariantProcessor } from './summary-variant.processor';
import { SummaryVariantService } from './summary-variant.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [
    KnowledgeModule,
    BullModule.registerQueue({
      name: SUMMARY_QUEUE,
    }),
    BullModule.registerQueue({
      name: SUMMARY_VARIANT_QUEUE,
    }),
  ],
  controllers: [SummaryController],
  providers: [
    SummaryService,
    SummaryJobService,
    SummaryProcessor,
    ContentExtractorService,
    AiSummaryService,
    ThreadDetectionService,
    SummaryVariantService,
    SummaryVariantJobService,
    SummaryVariantProcessor,
  ],
  exports: [SummaryService],
})
export class SummaryModule {}
