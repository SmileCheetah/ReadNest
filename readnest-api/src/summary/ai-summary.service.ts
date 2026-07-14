import { GoogleGenAI, Type } from '@google/genai';
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
  summaryType: string;
  title: string;
  oneLineSummary: string;
  coreSummary: string;
  keyPoints: string[];
  tags: string[];
  readingValue: string;
  caution: string;
  contextStatus: '완결' | '맥락 부족' | '부분 요약' | '불명확';
  threadStatus: string;
  confidence: number;
};

@Injectable()
export class AiSummaryService {
  private readonly logger = new Logger(AiSummaryService.name);
  private readonly client: GoogleGenAI | null;
  private readonly model: string;

  constructor(configService: ConfigService) {
    const apiKey = configService.get<string>('GEMINI_API_KEY');
    this.model =
      configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash';
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
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
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [
          '너는 ReadNest의 콘텐츠 요약 엔진이다.',
          'ReadNest는 사용자가 SNS와 웹에서 발견한 글을 저장하면 AI가 내용을 요약하고 날짜별 아카이브로 정리해주는 개인 지식 큐레이션 서비스다.',
          '너의 역할은 원문을 짧게 줄이는 것이 아니라 사용자가 나중에 다시 읽기 좋도록 핵심 의미를 구조화하는 것이다.',
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
          '글의 성격에 맞는 요약 방식을 선택한다.',
          '요약은 짧고 명확하게 작성한다.',
          '핵심 포인트는 중복되지 않게 작성한다.',
          '사용자가 원문을 다시 읽을지 판단할 수 있도록 읽을 가치를 알려준다.',
          '투자, 건강, 법률, 정치처럼 민감한 주제는 주의점을 반드시 포함한다.',
          '연속 글 일부만 저장된 경우 전체 내용을 단정하지 않는다.',
          '',
          '# 요약 유형',
          'summaryType은 정보 정리형, 주장 분석형, 학습 자료형, 아이디어 저장형, 행동 추천형, 기타 중 하나로 작성한다.',
          '',
          '# 출력 JSON 필드',
          'summaryType: 요약 유형',
          'title: 원문 제목을 다듬거나 30자 안팎으로 생성',
          'oneLineSummary: 목록에서 보여줄 수 있는 한 문장 요약',
          'coreSummary: 최대 3문장 핵심 요약. 배경, 핵심 주장, 결론이 자연스럽게 이어져야 한다.',
          'keyPoints: 기본 3개, 긴 글이나 연속 글이면 최대 5개. 번호형 Thread는 1., 2. 형식으로 주장 흐름을 보존한다.',
          'tags: 3개에서 5개',
          'readingValue: 이 글을 왜 저장할 만한지 활용 관점으로 설명',
          'caution: 민감 주제는 주의점, 일반 글은 간단한 확인 관점',
          'contextStatus: 완결, 맥락 부족, 부분 요약, 불명확 중 하나',
          'threadStatus: 전체 포함 9 of 9, 일부 포함, 해당 없음 같은 형태',
          'confidence: 0에서 1 사이 숫자',
          '',
          '# 유형별 기준',
          '정보 정리형은 무슨 일이 있었는가, 왜 중요한가, 앞으로 무엇을 봐야 하는가를 담는다.',
          '주장 분석형은 핵심 주장, 근거, 예상 전개, 주의해서 볼 점을 담는다.',
          '학습 자료형은 핵심 개념, 배워야 할 내용, 학습 순서, 다시 볼 포인트를 담는다.',
          '아이디어 저장형은 아이디어 핵심, 해결 문제, 타깃 사용자, 적용할 부분을 담는다.',
          '행동 추천형은 핵심 조언, 바로 할 행동, 주의할 점, 실천 난이도를 담는다.',
        ].join('\n'),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summaryType: { type: Type.STRING },
              title: { type: Type.STRING },
              oneLineSummary: { type: Type.STRING },
              coreSummary: { type: Type.STRING },
              keyPoints: {
                type: Type.ARRAY,
                minItems: '3',
                maxItems: '5',
                items: { type: Type.STRING },
              },
              tags: {
                type: Type.ARRAY,
                minItems: '3',
                maxItems: '5',
                items: { type: Type.STRING },
              },
              readingValue: { type: Type.STRING },
              caution: { type: Type.STRING },
              contextStatus: { type: Type.STRING },
              threadStatus: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
            },
            required: [
              'summaryType',
              'title',
              'oneLineSummary',
              'coreSummary',
              'keyPoints',
              'tags',
              'readingValue',
              'caution',
              'contextStatus',
              'threadStatus',
              'confidence',
            ],
            propertyOrdering: [
              'summaryType',
              'title',
              'oneLineSummary',
              'coreSummary',
              'keyPoints',
              'tags',
              'readingValue',
              'caution',
              'contextStatus',
              'threadStatus',
              'confidence',
            ],
          },
        },
      });

      return this.normalizeSummary(
        JSON.parse(response.text ?? '{}') as StructuredSummaryResult,
        input,
      );
    } catch (error) {
      this.logger.warn(
        `Gemini summary failed, using fallback: ${
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
            `한 줄 요약: ${title}에 대한 저장글입니다.`,
            '',
            '핵심 요약: Gemini API 키가 설정되면 원문 의미를 구조화한 요약으로 자동 생성됩니다.',
            '',
            '읽을 가치: 저장한 원문을 나중에 다시 검토할 수 있도록 보관되었습니다.',
            '주의점: 현재는 AI 요약 대신 fallback 요약이 저장되었습니다.',
            '맥락 상태: 완결',
            '연속 글 상태: unknown',
            '요약 신뢰도: 0.4',
          ].join('\n')
        : [
            '요약 유형: 기타',
            '한 줄 요약: 원문을 충분히 가져오지 못했습니다.',
            '',
            '핵심 요약: URL과 메타데이터를 기준으로 저장되었으며 추가 맥락이 필요할 수 있습니다.',
            '',
            '읽을 가치: 원문 링크를 보관했다는 점에서 다시 확인할 수 있습니다.',
            '주의점: 본문 정보가 부족해 요약 정확도가 낮습니다.',
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
      summary: [
        `요약 유형: ${result.summaryType}`,
        `한 줄 요약: ${result.oneLineSummary}`,
        '',
        `핵심 요약: ${result.coreSummary}`,
        '',
        `읽을 가치: ${result.readingValue}`,
        `주의점: ${result.caution}`,
        `맥락 상태: ${result.contextStatus}`,
        `연속 글 상태: ${result.threadStatus}`,
        `요약 신뢰도: ${confidence}`,
      ].join('\n'),
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
        'Gemini API 키가 설정되면 원문 의미를 구조화한 요약으로 자동 생성됩니다.',
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
