import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SummaryResult = {
  title: string;
  summary: string;
  keyPoints: string[];
  tags: string[];
  contextInsufficient: boolean;
  meta: StructuredSummaryResult;
};

export type StructuredSummaryResult = {
  schemaVersion?: number;
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

export const MAX_SUMMARY_MARKDOWN_LENGTH = 16000;

export function validateSummaryMarkdown(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const markdown = value.trim();
  if (!markdown || markdown.length > MAX_SUMMARY_MARKDOWN_LENGTH) return false;
  if (/<\/?[a-z][^>]*>|<iframe\b|<img\b/i.test(markdown)) return false;
  if (/```|\[([^\]]+)\]\((?:javascript|data|vbscript):/i.test(markdown)) {
    return false;
  }
  if (/^\s*\|.*\|\s*$/m.test(markdown) || /^\s*[-:]+\s*\|/m.test(markdown)) {
    return false;
  }
  if (/\[[^\]]+\]\([^)]+\)/i.test(markdown)) return false;
  if (/^#{1}(?:\s|$)|^#{4,}(?:\s|$)/m.test(markdown)) return false;
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const uniqueParagraphs = new Set(paragraphs);
  if (uniqueParagraphs.size !== paragraphs.length) return false;
  const boldCount = (markdown.match(/\*\*[^*]+\*\*/g) ?? []).length;
  const paragraphCount = Math.max(1, paragraphs.length);
  return boldCount <= paragraphCount * 2;
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
      return this.createFallbackSummary(input);
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
          '전체 출력 분량은 원문 분량의 15~30% 이내를 목표로 하되, 짧은 원문은 2~4개 자연스러운 문단으로 끝낸다.',
          '핵심 키워드와 keyPoints는 원문에 실제로 있는 내용만 담고, 원문에 없는 개수나 항목을 맞추기 위해 늘리지 않는다.',
          'summaryMarkdown의 구조는 원문 형식에 적응한다. 주장형은 주장→근거→의미, 번호형은 원문 번호·개수·순서, 비교형은 A/B 차이와 의미, 정보형은 사실→맥락으로 구성한다.',
          '원문이 단일 주장이나 짧은 글이면 heading·목록·결론 섹션을 억지로 만들지 말고 2~4개 문단으로 마친다.',
          '번호형 큰 항목이 원문에 있을 때만 ### 1. 제목, ### 2. 제목 형식의 heading을 사용한다. 큰 항목 제목을 ordered list나 1. **제목**으로 만들지 않는다.',
          'bullet은 원문에 실제 열거가 있거나 문장을 압축하는 데 분명히 유리할 때만 사용한다. 각 bullet은 하나의 완결된 생각이어야 한다.',
          '인용문은 원문의 핵심 메시지를 짧게 압축할 때만 사용하고, 원문에 없는 결론·조언·배울 점을 만들지 않는다.',
          'summaryMarkdown에는 ## 또는 ### heading, **굵은 강조**, 번호 목록, bullet 목록, blockquote, 문단과 줄바꿈만 사용한다. #/#### 이상 heading, raw HTML, 이미지, iframe, 표, 코드 펜스, 실행 코드, 링크는 절대 생성하지 않는다.',
          '굵은 강조는 문단마다 핵심 표현 1~2개 이하로 제한하고, 같은 문단이나 내용을 반복하지 않는다.',
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
          'schemaVersion: 반드시 숫자 2',
          'summaryMarkdown: 상세 화면용 완성형 Markdown 요약',
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
                schemaVersion: { type: 'number', enum: [2] },
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
                summaryMarkdown: { type: 'string' },
              },
              required: [
                'schemaVersion',
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
                'summaryMarkdown',
              ],
              additionalProperties: false,
            },
          },
        },
      });

      const parsed = JSON.parse(
        response.output_text || '{}',
      ) as StructuredSummaryResult;
      if (
        parsed.schemaVersion !== 2 ||
        !validateSummaryMarkdown(parsed.summaryMarkdown)
      ) {
        this.logger.warn('V2 summary validation failed, using V1 fallback');
        return this.normalizeLegacyStructuredSummary(parsed, input);
      }
      return this.normalizeSummary(parsed, input);
    } catch (error) {
      this.logger.warn(
        `OpenAI summary failed, using fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return this.createFallbackSummary(input);
    }
  }

  private createFallbackSummary(input: {
    url: string;
    title?: string | null;
    text: string;
  }): SummaryResult {
    const title = input.title || this.createTitleFromUrl(input.url);
    const hasText = input.text.trim().length > 80;

    return {
      title,
      summary: hasText
        ? [
            '요약 유형: 기타',
            `제목: ${title}`,
            `한 줄 요약: ${title}에 대한 저장글입니다.`,
            '',
            '핵심 주장: OpenAI API 키가 설정되면 원문 의미를 구조화한 요약으로 자동 생성됩니다.',
            '주요 내용:',
            ...this.createFallbackKeyPoints(input.text).map(
              (point, index) => `${index + 1}. ${point}`,
            ),
            '',
            '결론: 현재는 AI 요약 대신 fallback 요약이 저장되었습니다.',
            '핵심 키워드: Threads, 요약대기',
            '맥락 상태: 완결',
            '연속 글 상태: unknown',
            '요약 신뢰도: 0.4',
          ].join('\n')
        : [
            '요약 유형: 기타',
            `제목: ${title}`,
            '한 줄 요약: 원문을 충분히 가져오지 못했습니다.',
            '',
            '핵심 주장: URL과 메타데이터만 확인되어 원문의 핵심 주장을 판단할 수 없습니다.',
            '주요 내용:',
            '1. 원문 정보 부족',
            '',
            '결론: 추가 원문 맥락이 필요합니다.',
            '핵심 키워드: Threads',
            '맥락 상태: 불명확',
            '연속 글 상태: unknown',
            '요약 신뢰도: 0.2',
          ].join('\n'),
      keyPoints: hasText
        ? this.createFallbackKeyPoints(input.text)
        : ['URL 저장 완료', '원문 추출 제한 감지', '추가 맥락 확인 필요'],
      tags: ['Threads', 'ReadNest', hasText ? '요약대기' : '맥락부족'],
      contextInsufficient: !hasText,
      meta: this.createFallbackMeta(input, title, hasText),
    };
  }

  private normalizeSummary(
    result: StructuredSummaryResult,
    input: { url: string; title?: string | null; text: string },
  ): SummaryResult {
    const confidence = Math.min(1, Math.max(0, Number(result.confidence) || 0));

    return {
      title: result.title || input.title || this.createTitleFromUrl(input.url),
      summary: this.createLegacySummaryText(result),
      keyPoints: result.keyPoints.slice(0, 5),
      tags: result.tags.slice(0, 5),
      contextInsufficient: ['맥락 부족', '부분 요약', '불명확'].includes(
        result.contextStatus,
      ),
      meta: {
        ...result,
        schemaVersion: result.schemaVersion ?? 1,
        confidence,
        keyPoints: result.keyPoints.slice(0, 5),
        tags: result.tags.slice(0, 5),
      },
    };
  }

  private normalizeLegacyStructuredSummary(
    result: Partial<StructuredSummaryResult>,
    input: { url: string; title?: string | null; text: string },
  ): SummaryResult {
    if (
      !result.title ||
      !result.oneLineSummary ||
      !result.coreSummary ||
      !Array.isArray(result.keyPoints) ||
      !Array.isArray(result.tags)
    )
      return this.createFallbackSummary(input);
    const legacyFields = { ...result };
    delete legacyFields.summaryMarkdown;
    delete legacyFields.schemaVersion;
    const normalized = {
      ...legacyFields,
      schemaVersion: 1,
      summaryType: result.summaryType ?? '기타',
      conclusion: result.conclusion ?? '',
      readingValue: result.readingValue ?? '',
      caution: result.caution ?? '',
      contextStatus: result.contextStatus ?? '불명확',
      threadStatus: result.threadStatus ?? '해당 없음',
      confidence: result.confidence ?? 0,
      keyPoints: result.keyPoints
        .filter((value): value is string => typeof value === 'string')
        .slice(0, 5),
      tags: result.tags
        .filter((value): value is string => typeof value === 'string')
        .slice(0, 5),
    } as StructuredSummaryResult;
    return {
      title: normalized.title,
      summary: this.createLegacySummaryText(normalized),
      keyPoints: normalized.keyPoints,
      tags: normalized.tags,
      contextInsufficient: ['맥락 부족', '부분 요약', '불명확'].includes(
        normalized.contextStatus,
      ),
      meta: normalized,
    };
  }

  private createLegacySummaryText(result: StructuredSummaryResult) {
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

  private createFallbackMeta(
    input: { url: string; title?: string | null; text: string },
    title: string,
    hasText: boolean,
  ): StructuredSummaryResult {
    if (!hasText) {
      return {
        summaryType: '기타',
        title,
        oneLineSummary: '원문을 충분히 가져오지 못했습니다.',
        coreSummary:
          'URL과 메타데이터를 기준으로 저장되었으며 추가 맥락이 필요할 수 있습니다.',
        conclusion: '추가 원문 맥락이 필요합니다.',
        keyPoints: [
          'URL 저장 완료',
          '원문 추출 제한 감지',
          '추가 맥락 확인 필요',
        ],
        tags: ['Threads', 'ReadNest', '맥락부족'],
        readingValue: '원문 링크를 보관했다는 점에서 다시 확인할 수 있습니다.',
        caution: '본문 정보가 부족해 요약 정확도가 낮습니다.',
        contextStatus: '불명확',
        threadStatus: this.detectThreadStatus(input.text),
        confidence: 0.2,
      };
    }

    return {
      summaryType: '기타',
      title,
      oneLineSummary: `${title}에 대한 저장글입니다.`,
      coreSummary:
        'OpenAI API 키가 설정되면 원문 의미를 구조화한 요약으로 자동 생성됩니다.',
      conclusion: '현재는 AI 요약 대신 fallback 요약이 저장되었습니다.',
      keyPoints: this.createFallbackKeyPoints(input.text),
      tags: ['Threads', 'ReadNest', '요약대기'],
      readingValue:
        '저장한 원문을 나중에 다시 검토할 수 있도록 보관되었습니다.',
      caution: '현재는 AI 요약 대신 fallback 요약이 저장되었습니다.',
      contextStatus: '완결',
      threadStatus: this.detectThreadStatus(input.text),
      confidence: 0.4,
    };
  }

  private detectThreadStatus(text: string) {
    const fractions = Array.from(
      text.matchAll(/(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\s|$)/g),
    );
    const dotted = Array.from(text.matchAll(/(?:^|\n)\s*(\d{1,2})\.\s+/g));
    const totals = fractions
      .map((match) => Number(match[2]))
      .filter((total) => Number.isInteger(total) && total > 1);
    const maxTotal = totals.length ? Math.max(...totals) : null;

    if (maxTotal) {
      const foundParts = new Set(fractions.map((match) => Number(match[1])));
      return foundParts.size >= maxTotal
        ? `전체 포함 ${maxTotal} of ${maxTotal}`
        : `일부 포함 ${foundParts.size} of ${maxTotal}`;
    }

    if (dotted.length >= 3) {
      return `전체 포함 ${dotted.length}개 번호형 글`;
    }

    return '해당 없음';
  }

  private createFallbackKeyPoints(text: string) {
    const normalizedText = text.replace(/\r\n/g, '\n');
    const numberedClaims = Array.from(
      normalizedText.matchAll(
        /(?:^|\n)\s*(\d{1,2})\.\s+([\s\S]*?)(?=\n\s*\d{1,2}\.\s+|$)/g,
      ),
    )
      .map((match) => {
        const partNumber = match[1];
        const claim = match[2]
          .replace(/\s+/g, ' ')
          .replace(/\s+\d{1,2}\s*\/\s*\d{1,2}\s*$/g, '')
          .trim();

        return claim ? `${partNumber}. ${claim.slice(0, 180)}` : null;
      })
      .filter((claim): claim is string => Boolean(claim))
      .slice(0, 12);

    if (numberedClaims.length >= 3) {
      return numberedClaims;
    }

    return [
      '원문 추출 완료',
      '요약 큐 처리 완료',
      '번호별 주장 구조 정리 가능',
    ];
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
