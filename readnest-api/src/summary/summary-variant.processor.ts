import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiSummaryService } from './ai-summary.service';
import { SUMMARY_VARIANT_QUEUE } from './summary.constants';
import { SummaryGenerationError, summaryFailure } from './summary-errors';
import {
  SummaryVariantJobData,
  SummaryVariantJobService,
} from './summary-variant-job.service';
import { validateSummaryMarkdown } from './summary-markdown-validator';
import { QueueSafetyService } from '../queue/queue-safety.service';
import {
  QUEUE_WORKER_OPTIONS,
  QuotaAwareWorkerHost,
} from '../queue/quota-aware-worker.host';

@Processor(SUMMARY_VARIANT_QUEUE, { ...QUEUE_WORKER_OPTIONS, concurrency: 2 })
export class SummaryVariantProcessor extends QuotaAwareWorkerHost {
  private readonly logger = new Logger(SummaryVariantProcessor.name);

  constructor(
    private readonly jobs: SummaryVariantJobService,
    private readonly aiSummaryService: AiSummaryService,
    queueSafety: QueueSafetyService,
  ) {
    super(queueSafety);
  }

  async process(job: Job<SummaryVariantJobData>) {
    const claimed = await this.jobs.claim(job.data);
    if (!claimed) return;
    const { article, variant, task, lease } = claimed;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.jobs
        .heartbeat(lease)
        .then((alive) => {
          if (!alive) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    }, 20000);
    heartbeat.unref();
    try {
      let markdown =
        typeof task.result === 'string' && validateSummaryMarkdown(task.result)
          ? task.result
          : null;
      if (!markdown) {
        const result = await this.aiSummaryService.summarize({
          url: article.url,
          title: article.title,
          text: article.rawText!,
          density: variant.density,
        });
        if (!validateSummaryMarkdown(result.meta.summaryMarkdown))
          throw new SummaryGenerationError(
            '요약 형식을 확인하지 못했습니다. 다시 생성해 주세요.',
            'INVALID_MARKDOWN',
            false,
          );
        markdown = result.meta.summaryMarkdown;
        await this.jobs.checkpoint(lease, markdown);
      }
      if (leaseLost) return;
      const saved = await this.jobs.complete(lease, markdown);
      if (saved)
        this.logger.log(
          `Summary variant completed: article=${article.id} density=${variant.density}`,
        );
    } catch (error) {
      const failure = summaryFailure(error);
      if (failure.code === 'STALE_JOB' || leaseLost) return;
      this.logger.warn(
        `Summary variant failed: article=${article.id} density=${variant.density} code=${failure.code}`,
      );
      await this.jobs.fail(lease, failure, task.attempts);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
