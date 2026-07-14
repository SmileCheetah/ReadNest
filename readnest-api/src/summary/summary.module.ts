import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SUMMARY_QUEUE } from './summary.constants';
import { AiSummaryService } from './ai-summary.service';
import { ContentExtractorService } from './content-extractor.service';
import { SummaryController } from './summary.controller';
import { SummaryProcessor } from './summary.processor';
import { SummaryService } from './summary.service';
import { ThreadDetectionService } from './thread-detection.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SUMMARY_QUEUE,
    }),
  ],
  controllers: [SummaryController],
  providers: [
    SummaryService,
    SummaryProcessor,
    ContentExtractorService,
    AiSummaryService,
    ThreadDetectionService,
  ],
  exports: [SummaryService],
})
export class SummaryModule {}
