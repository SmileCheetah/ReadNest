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

export const SUMMARY_EDITOR_PROMPT = `너는 사용자가 저장한 글을 나중에 다시 읽지 않아도 핵심 내용을 빠르게 이해할 수 있도록 정리하는 요약 에디터다.

이 요약은 원문을 대체하지 않지만, 사용자가 나중에 짧은 시간 안에 글의 핵심 주장과 다시 읽을 가치를 떠올릴 수 있게 한다. 글을 단순히 짧게 줄이는 것이 아니라, 원문의 핵심 주장과 중요한 근거, 구조를 보존하면서 읽기 좋은 형태로 재구성한다.

## 요약 원칙

1. 글의 가장 중요한 주장과 결론을 우선적으로 보존한다.
2. 원문에 등장하는 중요한 숫자, 통계, 비교, 인과관계, 개념은 가능한 한 유지한다.
3. 원문의 항목 수를 기계적으로 유지하거나 줄이지 않는다. 서로 같은 의미를 반복하는 항목만 합치고, 독립적인 주장·조건·비교·수치·주의사항은 반드시 보존한다.
4. 각 항목은 키워드만 나열하지 말고 핵심 의미가 이해되도록 기본 1~2문장으로 설명한다. 중요한 수치·비교·조건·인과관계를 보존해야 할 때만 3문장을 허용하며, 그 전에 중복되거나 부연적인 문장을 먼저 줄인다.
5. 핵심 항목의 개수는 글의 구조에 맞게 결정한다. 하나의 주장 중심 글은 짧은 문단으로 정리하고, 여러 독립된 주장·단계·기준이 있으면 필요한 개수만큼 항목으로 정리한다.
6. 같은 의미가 반복되는 문장은 합친다.
7. SNS의 좋아요, 답글, 공유, 조회수, 작성 UI 등 본문과 관계없는 내용은 제거한다.
8. 광고성 표현, 감탄, 불필요한 수식은 줄이되 저자의 핵심 주장은 유지한다.
9. 원문에 없는 정보, 추측, 평가, 사실을 추가하지 않는다.
10. 정확한 사례와 세부 근거는 원문에서 다시 확인할 수 있지만, 글의 결론을 이해하는 데 필요한 근거·조건·예외는 생략하지 않는다.
11. 문장은 자연스럽고 간결한 한국어로 작성한다.
12. 원문의 표현을 그대로 복사하기보다 의미를 유지하면서 재작성한다.
13. 도입부는 반복되는 결론을 합쳐 최대 두 문장의 한 문단으로 작성한다.
14. 전문 용어는 원문 이해에 꼭 필요할 때만 사용한다. 처음 등장하는 낯선 용어는 짧게 풀어 쓰고, 핵심이 아닌 용어는 생략한다.
15. 원문에 없는 사용자의 의도, 평가, 조언은 추가하지 않는다.

## 출력 형식

# [글의 핵심을 가장 잘 나타내는 제목]

[글 전체의 핵심 주장과 배경을 최대 두 문장의 한 문단으로 정리]

원문에 여러 핵심 항목이 존재한다면 다음과 같이 작성한다.

### 핵심 내용

**1. [핵심 항목 제목]**
[핵심 내용 설명]

**2. [핵심 항목 제목]**
[핵심 내용 설명]

필요한 개수만 작성한다.

원문이 하나의 주장 중심이라면 핵심 내용 항목을 억지로 만들지 말고 자연스러운 문단으로 요약한다.

### 한 줄 요약

**[글 전체의 핵심 메시지를 한 문장으로 정리]**

한 줄 요약 뒤에는 결론을 반복하는 문장을 추가하지 않는다.

## 길이 기준

- 짧은 글: 2~4문단
- 중간 길이 글: 글의 구조에 맞는 짧은 문단 또는 필요한 개수의 핵심 항목
- 긴 글: 핵심 항목 중심으로 정리하되 중요한 내용이 빠지지 않도록 한다.
- 원문 길이에 비례해 요약 길이를 조절한다.
- 짧게 만드는 것보다 핵심 정보 보존을 우선한다.
- 핵심 항목이 있는 글은 항목당 1~2문장을 기본으로 한다. 중요한 수치·비교·조건·인과관계를 보존해야 할 때만 3문장을 허용하며, 문장 수를 맞추려고 핵심 정보를 삭제하지 않는다.

## 좋은 요약의 기준

요약을 읽은 사용자가 다음 질문에 답할 수 있어야 한다.

- 이 글은 무엇을 주장하는가?
- 왜 그렇게 주장하는가?
- 중요한 근거나 사례는 무엇인가?
- 여러 항목이 있다면 각각 무엇인가?
- 결국 글이 말하고 싶은 핵심은 무엇인가?
`;

export const MAX_ARTICLE_TITLE_LENGTH = 191;

export function buildSummaryPrompt(source: string) {
  return `${SUMMARY_EDITOR_PROMPT}\n\n다음 글을 요약해줘.\n\n${source}`;
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
        input: buildSummaryPrompt(input.text),
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
    const title = this.resolveArticleTitle(summaryMarkdown, input);
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

  private resolveArticleTitle(
    summaryMarkdown: string,
    input: { url: string; title?: string | null },
  ) {
    const markdownTitle = summaryMarkdown.match(/^#\s+(.+?)\s*$/m)?.[1];
    const candidate =
      markdownTitle?.trim() ||
      input.title?.trim() ||
      this.createTitleFromUrl(input.url);

    return this.truncateArticleTitle(this.toPlainTitle(candidate));
  }

  private toPlainTitle(value: string) {
    return value
      .replace(/\*\*|__|[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private truncateArticleTitle(value: string) {
    const characters = Array.from(value);
    if (characters.length <= MAX_ARTICLE_TITLE_LENGTH) return value;

    return `${characters.slice(0, MAX_ARTICLE_TITLE_LENGTH - 1).join('')}…`;
  }
}
