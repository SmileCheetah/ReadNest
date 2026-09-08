import {
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
