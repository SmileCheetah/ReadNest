/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  AiSummaryService,
  MAX_SUMMARY_MARKDOWN_LENGTH,
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

  it('falls back to AI structured fields when only markdown is invalid', () => {
    const result = service.normalizeLegacyStructuredSummary(
      { ...structured, summaryMarkdown: '<script>bad</script>' },
      input,
    );
    expect(result.title).toBe(structured.title);
    expect(result.keyPoints).toEqual(structured.keyPoints);
    expect(result.summary).toContain(structured.oneLineSummary);
    expect(result.summary).not.toContain('<script>');
    expect(result.meta.schemaVersion).toBe(1);
    expect(result.meta.summaryMarkdown).toBeUndefined();
  });

  it('preserves the Python golden-meaning fixture', () => {
    expect(structured.coreSummary).toContain('사람과 AI 모두 Python');
    expect(structured.keyPoints.join(' ')).toContain('C/C++·CUDA');
    expect(structured.conclusion).toContain('생태계와 네트워크 효과');
  });

  it.each(['timeout', '429', '500'])(
    'uses fallback when OpenAI returns %s',
    async (kind) => {
      const failing = Object.create(AiSummaryService.prototype);
      failing.logger = { warn: jest.fn() };
      failing.client = {
        responses: {
          create: jest.fn().mockRejectedValue(new Error(`OpenAI ${kind}`)),
        },
      };
      failing.model = 'gpt-5.6-luna';
      const result = await failing.summarize(input);
      expect(result.meta.schemaVersion).not.toBe(2);
      expect(result.summary).not.toContain('###');
    },
  );
});
