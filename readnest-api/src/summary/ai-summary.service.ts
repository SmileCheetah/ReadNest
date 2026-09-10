import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export {
  MAX_SUMMARY_MARKDOWN_LENGTH,
  validateSummaryMarkdown,
} from './summary-markdown-validator';
import { validateSummaryMarkdown } from './summary-markdown-validator';

export type StructuredSummaryResult = {
  summaryType: string;
  title: string;
  oneLineSummary: string;
  coreSummary: string;
  keyPoints: string[];
  conclusion: string;
  tags: string[];
  readingValue: string;
  caution: string;
  contextStatus: '완결' | '맥락 부족' | '부분 요약' | '불명확';
  threadStatus: string;
  confidence: number;
  summaryMarkdown: string;
};

export type SummaryResult = {
  title: string;
  summary: string;
  keyPoints: string[];
  tags: string[];
  contextInsufficient: boolean;
  meta: StructuredSummaryResult;
};

export class SummaryGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SummaryGenerationError';
  }
}

@Injectable()
export class AiSummaryService {
  private readonly logger = new Logger(AiSummaryService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(configService: ConfigService) {
    const apiKey = configService.get<string>('OPENAI_API_KEY');
    this.model = configService.get<string>('OPENAI_MODEL') ?? 'gpt-5.6-luna';
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async summarize(input: { url: string; title?: string | null; text: string }) {
    if (!this.client) {
      throw new SummaryGenerationError(
        'AI 요약 설정이 필요합니다. 서버 설정을 확인한 뒤 다시 시도해 주세요.',
      );
    }

    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: `다음 글을 요약해줘.\n\n${input.text}`,
      });
      const summaryMarkdown = response.output_text?.trim() ?? '';

      if (!validateSummaryMarkdown(summaryMarkdown)) {
        this.logger.warn('Summary Markdown validation failed');
        throw new SummaryGenerationError(
          '요약 형식을 검증하지 못했습니다. 요약을 다시 생성해 주세요.',
        );
      }

      return this.normalizeSummary(summaryMarkdown, input);
    } catch (error) {
      if (error instanceof SummaryGenerationError) throw error;
      this.logger.warn(
        `OpenAI summary failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new SummaryGenerationError(
        'AI 요약 생성 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
  }

  private normalizeSummary(
    summaryMarkdown: string,
    input: { url: string; title?: string | null; text: string },
  ): SummaryResult {
    const title = input.title?.trim() || this.createTitleFromUrl(input.url);
    const firstParagraph = summaryMarkdown.split(/\n\s*\n/)[0]?.trim() ?? '';
    const meta: StructuredSummaryResult = {
      summaryType: '자유 형식 요약',
      title,
      oneLineSummary: firstParagraph,
      coreSummary: summaryMarkdown,
      keyPoints: [],
      conclusion: '',
      tags: [],
      readingValue: '',
      caution: '',
      contextStatus: '완결',
      threadStatus: '해당 없음',
      confidence: 0,
      summaryMarkdown,
    };

    return {
      title,
      summary: summaryMarkdown,
      keyPoints: [],
      tags: [],
      contextInsufficient: false,
      meta,
    };
  }

  private createTitleFromUrl(url: string) {
    try {
      return `${new URL(url).hostname} 저장글`;
    } catch {
      return '저장된 Thread';
    }
  }
}
