import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildSummaryMarkdown,
  SummaryDocument,
} from './summary-markdown-builder';
export {
  MAX_SUMMARY_MARKDOWN_LENGTH,
  validateSummaryMarkdown,
} from './summary-markdown-validator';

export type SummaryResult = {
  title: string;
  summary: string;
  keyPoints: string[];
  tags: string[];
  contextInsufficient: boolean;
  meta: StructuredSummaryResult;
};

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
  summaryMarkdown?: string;
};

type GeneratedSummaryPayload = Omit<
  StructuredSummaryResult,
  'summaryMarkdown'
> & { document: SummaryDocument };

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

  async summarize(input: {
    url: string;
    title?: string | null;
    text: string;
  }): Promise<SummaryResult> {
    if (!this.client) {
      throw new SummaryGenerationError(
        'AI 요약 설정이 필요합니다. 서버 설정을 확인한 뒤 다시 시도해 주세요.',
      );
    }

    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: [
          '너는 Unwind의 콘텐츠 요약 엔진이다.',
          '너의 역할은 원문에 충실하게 내용을 압축하는 것이다. 원문에 없는 해석, 평가, 활용 제안은 추가하지 않는다.',
          '반드시 자연스러운 한국어 JSON만 반환한다.',
          '',
          '# 입력 데이터',
          '출처: Threads 또는 웹',
          `원문 제목: ${input.title ?? ''}`,
          `원문 링크: ${input.url}`,
          '저장된 파트 정보: unknown',
          `원문 내용:\n${input.text || '(empty)'}`,
          '',
          '# 핵심 원칙',
          '원문에 없는 내용을 지어내지 않는다.',
          '확실하지 않은 내용은 단정하지 않는다.',
          '핵심 주장, 근거, 주요 항목, 결론의 원문 흐름을 유지한다.',
          '원문에 제시된 숫자, 분류 체계, 항목 순서, 단계 수를 그대로 보존한다.',
          '사례와 반복은 줄이되 각 항목의 판단 기준과 인과관계는 남긴다.',
          '반복과 부수적인 예시는 줄이되 원문의 복잡도와 항목 수에 맞게 필요한 만큼 요약한다. 고정된 문자 수나 비율을 맞추기 위해 핵심 논리를 생략하지 않는다.',
          '핵심 키워드와 keyPoints는 원문에 실제로 있는 내용만 담고, 원문에 없는 개수나 항목을 맞추기 위해 늘리지 않는다.',
          'Markdown 기호를 작성하지 않는다. document에 일반 문자열로 구조화된 요약 내용만 반환하고 Backend가 최종 Markdown을 조립한다.',
          'document.style은 numbered, thematic, short 중 하나다. numbered는 명확한 번호형 원문에서만 사용하고 sourceOrder에 원래 번호를 넣는다. thematic은 번호 없이 주제별로 정리한다. short는 items를 비운다.',
          '첫 문단에 핵심 주장을 둔다. 기술 키워드를 한 문장에 과도하게 나열하지 않는다.',
          '원문의 중요한 메시지나 대조 논리가 있으면 takeaway에 짧게 담되, 원문에 없는 결론·조언·배울 점을 만들지 않는다.',
          '원문이 단일 주장이나 짧은 글이면 구조를 억지로 늘리지 말고 short를 사용한다.',
          '번호형 원문은 각 큰 항목을 하나의 item으로 만들고, 원래 번호·순서·핵심 논리를 보존한다.',
          'A라서가 아니라 B 때문이다, A에는 한계가 있지만 B 때문에 선택된다, 성능이 아니라 생태계가 경쟁력이다 같은 대조·양보·인과 논리를 생략하지 않는다.',
          '단순 키워드 나열이 아니라 근거 → 대조되는 사실 → 인과관계 → 결론의 흐름을 보존한다.',
          'readingValue와 caution은 원문에 명시된 내용이 없으면 빈 문자열로 둔다.',
          '연속 글 일부만 저장된 경우 전체 내용을 단정하지 않는다.',
          '',
          '# 요약 유형',
          'summaryType은 정보 정리형, 주장 분석형, 학습 자료형, 아이디어 저장형, 행동 추천형, 기타 중 하나로 작성한다.',
          '',
          '# 출력 JSON 필드',
          'summaryType: 요약 유형',
          'title: 원문의 메시지와 어조가 드러나는 제목',
          'oneLineSummary: 목록에서 보여줄 수 있는 한 문장 요약',
          'coreSummary: 핵심 주장과 주요 내용을 2~5개의 짧은 문장으로 정리. 원문 항목이 있으면 번호와 순서를 보존한다.',
          'keyPoints: 원문의 주요 항목을 중복 없이 짧게 정리. 화면의 보조 정보로 사용된다.',
          'conclusion: 원문의 결론을 1~2문장으로 정리. 원문에 결론이 없으면 빈 문자열',
          'tags: keyPoints와 같은 개수의 핵심 키워드',
          'readingValue: 원문에 명시된 효용이나 읽을 이유. 없으면 빈 문자열',
          'caution: 원문에 명시된 주의점. 없으면 빈 문자열',
          'contextStatus: 완결, 맥락 부족, 부분 요약, 불명확 중 하나',
          'threadStatus: 전체 포함 9 of 9, 일부 포함, 해당 없음 같은 형태',
          'confidence: 0에서 1 사이 숫자',
          'document: style, coreClaim, sectionTitle, items(sourceOrder/title/description), conclusion, takeaway를 가진 구조화 요약',
          '',
          '# 유형별 기준',
          '정보 정리형은 무슨 일이 있었는가, 왜 중요한가, 앞으로 무엇을 봐야 하는가를 담는다.',
          '주장 분석형은 핵심 주장, 근거, 예상 전개, 주의해서 볼 점을 담는다.',
          '학습 자료형은 핵심 개념, 배워야 할 내용, 학습 순서, 다시 볼 포인트를 담는다.',
          '아이디어 저장형은 아이디어 핵심, 해결 문제, 타깃 사용자, 적용할 부분을 담는다.',
          '행동 추천형은 핵심 조언, 바로 할 행동, 주의할 점, 실천 난이도를 담는다.',
        ].join('\n'),
        text: {
          format: {
            type: 'json_schema',
            name: 'unwind_summary',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                summaryType: { type: 'string' },
                title: { type: 'string' },
                oneLineSummary: { type: 'string' },
                coreSummary: { type: 'string' },
                keyPoints: {
                  type: 'array',
                  items: { type: 'string' },
                },
                conclusion: { type: 'string' },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                },
                readingValue: { type: 'string' },
                caution: { type: 'string' },
                contextStatus: { type: 'string' },
                threadStatus: { type: 'string' },
                confidence: { type: 'number' },
                document: {
                  type: 'object',
                  properties: {
                    style: {
                      type: 'string',
                      enum: ['numbered', 'thematic', 'short'],
                    },
                    coreClaim: { type: 'string' },
                    sectionTitle: { type: 'string' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          sourceOrder: { type: ['number', 'null'] },
                          title: { type: 'string' },
                          description: { type: 'string' },
                        },
                        required: ['sourceOrder', 'title', 'description'],
                        additionalProperties: false,
                      },
                    },
                    conclusion: { type: 'string' },
                    takeaway: { type: 'string' },
                  },
                  required: [
                    'style',
                    'coreClaim',
                    'sectionTitle',
                    'items',
                    'conclusion',
                    'takeaway',
                  ],
                  additionalProperties: false,
                },
              },
              required: [
                'summaryType',
                'title',
                'oneLineSummary',
                'coreSummary',
                'keyPoints',
                'conclusion',
                'tags',
                'readingValue',
                'caution',
                'contextStatus',
                'threadStatus',
                'confidence',
                'document',
              ],
              additionalProperties: false,
            },
          },
        },
      });

      const parsed = JSON.parse(
        response.output_text || '{}',
      ) as GeneratedSummaryPayload;
      const summaryMarkdown = buildSummaryMarkdown(parsed.document);
      if (!summaryMarkdown) {
        this.logger.warn('Summary Markdown validation failed');
        throw new SummaryGenerationError(
          '요약 형식을 검증하지 못했습니다. 요약을 다시 생성해 주세요.',
        );
      }
      return this.normalizeSummary({ ...parsed, summaryMarkdown }, input);
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
    result: StructuredSummaryResult,
    input: { url: string; title?: string | null; text: string },
  ): SummaryResult {
    const confidence = Math.min(1, Math.max(0, Number(result.confidence) || 0));

    return {
      title: result.title || input.title || this.createTitleFromUrl(input.url),
      summary: this.createPreviewSummaryText(result),
      keyPoints: result.keyPoints.slice(0, 5),
      tags: result.tags.slice(0, 5),
      contextInsufficient: ['맥락 부족', '부분 요약', '불명확'].includes(
        result.contextStatus,
      ),
      meta: {
        ...result,
        confidence,
        keyPoints: result.keyPoints.slice(0, 5),
        tags: result.tags.slice(0, 5),
      },
    };
  }

  private createPreviewSummaryText(result: StructuredSummaryResult) {
    return [
      '핵심 내용',
      '',
      result.coreSummary,
      '',
      '핵심 한 줄 요약',
      '',
      result.oneLineSummary,
    ].join('\n');
  }

  private createTitleFromUrl(url: string) {
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.hostname} 저장글`;
    } catch {
      return '저장된 Thread';
    }
  }
}
