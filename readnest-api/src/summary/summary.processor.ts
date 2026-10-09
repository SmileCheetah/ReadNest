import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AiSummaryService,
  SummaryResult,
  validateSummaryMarkdown,
} from './ai-summary.service';
import {
  ContentExtractorService,
  ExtractedContent,
} from './content-extractor.service';
import { SUMMARY_QUEUE } from './summary.constants';
import { SummaryJobData, SummaryJobService } from './summary-job.service';
import { SummaryGenerationError, summaryFailure } from './summary-errors';
import { ThreadDetectionService } from './thread-detection.service';
import { summaryPreview } from '../articles/utils/summary-preview';
import { ClassificationService } from '../knowledge/classification.service';

type Checkpoint = { summary: SummaryResult; source: ExtractedContent };

@Processor(SUMMARY_QUEUE, { concurrency: 2 })
export class SummaryProcessor extends WorkerHost {
  private readonly logger = new Logger(SummaryProcessor.name);
  constructor(
    private readonly jobs: SummaryJobService,
    private readonly contentExtractor: ContentExtractorService,
    private readonly aiSummaryService: AiSummaryService,
    private readonly threadDetectionService: ThreadDetectionService,
    private readonly classification: ClassificationService,
  ) {
    super();
  }

  async process(job: Job<SummaryJobData>) {
    const claimed = await this.jobs.claim(job.data);
    if (!claimed) return;
    const { article, task, lease } = claimed;
    const started = Date.now();
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
      let checkpoint = task.result as unknown as Checkpoint | null;
      if (
        !checkpoint?.summary?.meta ||
        !validateSummaryMarkdown(checkpoint.summary.meta.summaryMarkdown) ||
        typeof checkpoint.source?.text !== 'string' ||
        !checkpoint.source.text.trim()
      ) {
        await this.jobs.stage(lease, 'EXTRACTING');
        const source = await this.contentExtractor.extract(article.url);
        source.text = source.text.trim().slice(0, 50000);
        if (source.extractionStatus === 'FAILED' || !source.text) {
          throw new SummaryGenerationError(
            '원문을 가져오지 못했습니다. 원문 링크의 접근 상태를 확인한 뒤 다시 시도해 주세요.',
            'EXTRACTION_FAILED',
          );
        }
        await this.jobs.stage(lease, 'GENERATING');
        // A fresh source snapshot replaces prior extraction; never concatenate old rawText.
        const summary = await this.aiSummaryService.summarize({
          url: article.url,
          title: source.title ?? article.title,
          text: source.text,
        });
        if (!validateSummaryMarkdown(summary.meta.summaryMarkdown))
          throw new SummaryGenerationError(
            '요약 형식을 확인하지 못했습니다. 다시 생성해 주세요.',
            'INVALID_MARKDOWN',
            false,
          );
        checkpoint = { summary, source };
        await this.jobs.checkpoint(lease, checkpoint);
      }
      if (leaseLost) return;
      await this.jobs.stage(lease, 'PERSISTING');
      const { summary, source } = checkpoint;
      const completeness =
        source.sourceCompleteness === 'PARTIAL' ? 'PARTIAL' : 'UNKNOWN';
      const meta = {
        ...summary.meta,
        contextStatus: completeness === 'PARTIAL' ? '부분 요약' : '불명확',
        threadStatus: '확인하지 못함',
        confidence: 0,
      };
      const persisted = await this.jobs.complete(lease, {
        title: Array.from(summary.title).slice(0, 191).join(''),
        rawText: source.text,
        summary: summary.summary,
        summaryMeta: meta,
        summaryPreview: summaryPreview(summary.meta.summaryMarkdown),
        keyPoints: summary.keyPoints,
        tags: summary.tags,
        extractionStatus: source.extractionStatus,
        extractionConfidence: source.extractionConfidence,
        sourceCompleteness: completeness,
        processStatus:
          completeness === 'PARTIAL' ? 'CONTEXT_INSUFFICIENT' : 'SUMMARY_DONE',
      });
      if (!persisted) return;
      // Optional enrichment must not turn a persisted, useful summary into failure.
      try {
        await this.threadDetectionService.detectAndLink({
          articleId: article.id,
          userId: article.userId,
          title: summary.title,
          url: article.url,
          text: source.text,
        });
      } catch {
        this.logger.warn(
          `Summary enrichment failed: article=${article.id} generation=${lease.generation}`,
        );
      }
      try {
        await this.classification.schedule(article.id);
      } catch {
        this.logger.warn(
          `Classification scheduling failed: article=${article.id}`,
        );
      }
      this.logger.log(
        `Summary completed: article=${article.id} generation=${lease.generation} elapsedMs=${Date.now() - started}`,
      );
    } catch (error) {
      const failure = summaryFailure(error);
      if (failure.code === 'STALE_JOB' || leaseLost) return;
      this.logger.warn(
        `Summary failed: article=${article.id} generation=${lease.generation} code=${failure.code}`,
      );
      await this.jobs.fail(lease, failure, task.attempts);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
