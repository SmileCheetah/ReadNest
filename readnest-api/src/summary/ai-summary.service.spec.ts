/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  AiSummaryService,
  MAX_SUMMARY_MARKDOWN_LENGTH,
  SummaryGenerationError,
  validateSummaryMarkdown,
} from './ai-summary.service';

describe('validateSummaryMarkdown', () => {
  it('accepts the supported rich markdown subset', () => {
    expect(
      validateSummaryMarkdown(
        '### Python의 역할\n\n**핵심 주장**\n\n1. AI와 데이터를 연결한다.\n2. 생태계가 경쟁력이다.\n\n> 성능이 아니라 생태계가 경쟁력이다.',
      ),
    ).toBe(true);
  });

  it.each([
    '<script>alert(1)</script>',
    '[위험](javascript:alert(1))',
    '[사용자 링크](mailto:test@example.com)',
    '# 잘못된 제목',
    '#### 너무 깊은 제목',
    '| 표 | 값 |\n| --- | --- |',
    '```ts\nconsole.log(1)\n```',
  ])('rejects unsupported markdown: %s', (value) => {
    expect(validateSummaryMarkdown(value)).toBe(false);
  });

  it('rejects empty, oversized, and duplicated paragraphs', () => {
    expect(validateSummaryMarkdown('   ')).toBe(false);
    expect(
      validateSummaryMarkdown('a'.repeat(MAX_SUMMARY_MARKDOWN_LENGTH + 1)),
    ).toBe(false);
    expect(validateSummaryMarkdown('같은 문단\n\n같은 문단')).toBe(false);
  });
});

describe('summary compatibility normalization', () => {
  const goldenFixtures = {
    numbered:
      '### 1. 문제\n\n첫째 근거다.\n\n### 2. 원인\n\n둘째 근거다.\n\n### 3. 선택\n\n셋째 근거다.\n\n### 4. 결과\n\n넷째 근거다.\n\n### 5. 결론\n\n다섯째 결론이다.',
    short:
      '제품은 단순해야 한다.\n\n사용자가 핵심 기능을 바로 이해해야 하기 때문이다.',
    comparison:
      '### A와 B의 차이\n\nA는 빠르지만 확장에 한계가 있다. B는 느릴 수 있지만 생태계 때문에 선택된다.\n\n> 성능이 아니라 생태계가 경쟁력이다.',
  };

  it('preserves the shape of adaptive golden fixtures', () => {
    expect(validateSummaryMarkdown(goldenFixtures.numbered)).toBe(true);
    expect(goldenFixtures.numbered.match(/### [1-5]\./g)).toEqual([
      '### 1.',
      '### 2.',
      '### 3.',
      '### 4.',
      '### 5.',
    ]);
    expect(validateSummaryMarkdown(goldenFixtures.short)).toBe(true);
    expect(goldenFixtures.short).not.toMatch(/(^|\n)\s*\d+\.\s/);
    expect(validateSummaryMarkdown(goldenFixtures.comparison)).toBe(true);
    expect(goldenFixtures.comparison).toContain('성능이 아니라 생태계');
  });
  const service = Object.create(AiSummaryService.prototype);
  const input = { url: 'https://example.com/python', text: '원문'.repeat(50) };
  const structured = {
    schemaVersion: 2,
    summaryType: '학습 자료형',
    title: 'Python의 경쟁력',
    oneLineSummary: 'Python은 여러 분야를 연결한다.',
    coreSummary: '사람과 AI 모두 Python을 사용한다.',
    keyPoints: [
      '1. AI·데이터·웹·자동화를 연결한다.',
      '2. C/C++·CUDA가 연산을 담당한다.',
    ],
    conclusion: '생태계와 네트워크 효과가 경쟁력이다.',
    tags: ['Python', '생태계'],
    readingValue: '',
    caution: '',
    contextStatus: '완결',
    threadStatus: '해당 없음',
    confidence: 0.9,
    summaryMarkdown:
      '### Python\n\n**연결**\n\n- AI와 데이터를 연결한다.\n\n> 생태계가 경쟁력이다.',
  };

  it('keeps legacy summary plain text while storing markdown in metadata', () => {
    const result = service.normalizeSummary(structured, input);
    expect(result.summary).not.toContain('###');
    expect(result.summary).not.toContain('**');
    expect(result.meta.summaryMarkdown).toContain('### Python');
    expect(result.meta.schemaVersion).toBe(2);
  });

  it('preserves the Python golden-meaning fixture', () => {
    expect(structured.coreSummary).toContain('사람과 AI 모두 Python');
    expect(structured.keyPoints.join(' ')).toContain('C/C++·CUDA');
    expect(structured.conclusion).toContain('생태계와 네트워크 효과');
  });

  it('throws instead of creating a V1 summary when the AI client is unavailable', async () => {
    const unavailable = Object.create(AiSummaryService.prototype);
    unavailable.client = null;

    await expect(unavailable.summarize(input)).rejects.toBeInstanceOf(
      SummaryGenerationError,
    );
  });

  it.each(['timeout', '429', '500'])(
    'throws a retryable summary error when OpenAI returns %s',
    async (kind) => {
      const failing = Object.create(AiSummaryService.prototype);
      failing.logger = { warn: jest.fn() };
      failing.client = {
        responses: {
          create: jest.fn().mockRejectedValue(new Error(`OpenAI ${kind}`)),
        },
      };
      failing.model = 'gpt-5.6-luna';
      await expect(failing.summarize(input)).rejects.toEqual(
        expect.objectContaining({
          name: 'SummaryGenerationError',
          message: expect.stringContaining('다시 시도'),
        }),
      );
    },
  );

  it('throws instead of returning V1 when the V2 document is invalid', async () => {
    const mocked = Object.create(AiSummaryService.prototype);
    mocked.logger = { warn: jest.fn() };
    mocked.model = 'gpt-5.6-luna';
    mocked.client = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: JSON.stringify({
            ...structured,
            document: {
              style: 'numbered',
              coreClaim: '핵심 주장',
              sectionTitle: '다섯 가지 역량',
              items: [],
              conclusion: '',
              takeaway: '',
            },
          }),
        }),
      },
    };

    await expect(mocked.summarize(input)).rejects.toBeInstanceOf(
      SummaryGenerationError,
    );
  });

  it.each([
    [
      'numbered',
      goldenFixtures.numbered,
      /\*\*1\. 1번\*\*[\s\S]*\*\*2\. 2번\*\*[\s\S]*\*\*3\. 3번\*\*[\s\S]*\*\*4\. 4번\*\*[\s\S]*\*\*5\. 5번\*\*/,
    ],
    ['short', goldenFixtures.short, /^(?!.*###)(?!.*(^|\n)\s*\d+\.\s)/],
    [
      'comparison',
      goldenFixtures.comparison,
      /A는 빠르지만[\s\S]*B는 생태계 때문에 선택된다[\s\S]*> 성능이 아니라 생태계/,
    ],
  ] as const)(
    'summarize preserves the %s V2 response shape',
    async (_name, markdown, expected) => {
      const mocked = Object.create(AiSummaryService.prototype);
      mocked.logger = { warn: jest.fn() };
      mocked.model = 'gpt-5.6-luna';
      mocked.client = {
        responses: {
          create: jest.fn().mockResolvedValue({
            output_text: JSON.stringify({
              ...structured,
              document: {
                style:
                  _name === 'numbered'
                    ? 'numbered'
                    : _name === 'short'
                      ? 'short'
                      : 'thematic',
                coreClaim: _name === 'short' ? markdown : '핵심 주장이다.',
                sectionTitle:
                  _name === 'numbered'
                    ? '원문 항목'
                    : _name === 'comparison'
                      ? '비교'
                      : '',
                items:
                  _name === 'numbered'
                    ? [1, 2, 3, 4, 5].map((sourceOrder) => ({
                        sourceOrder,
                        title: `${sourceOrder}번`,
                        description: `${sourceOrder}번 설명이다.`,
                      }))
                    : _name === 'comparison'
                      ? [
                          {
                            sourceOrder: null,
                            title: '비교',
                            description:
                              'A는 빠르지만 B는 생태계 때문에 선택된다.',
                          },
                        ]
                      : [],
                conclusion: '',
                takeaway:
                  _name === 'comparison'
                    ? '성능이 아니라 생태계가 경쟁력이다.'
                    : '',
              },
            }),
          }),
        },
      };
      const result = await mocked.summarize(input);
      expect(result.meta.schemaVersion).toBe(2);
      expect(result.meta.summaryMarkdown).toBeDefined();
      expect(result.meta.summaryMarkdown).toMatch(expected);
    },
  );
});
