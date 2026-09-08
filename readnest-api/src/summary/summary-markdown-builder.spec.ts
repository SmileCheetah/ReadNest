import { buildSummaryMarkdown } from './summary-markdown-builder';
import { validateSummaryMarkdown } from './ai-summary.service';

describe('buildSummaryMarkdown', () => {
  it('preserves ten numbered items without item headings', () => {
    const markdown = buildSummaryMarkdown({
      style: 'numbered',
      coreClaim: '핵심 주장이다.',
      sectionTitle: 'Astra를 제대로 사용하는 10가지 원칙',
      items: Array.from({ length: 10 }, (_, index) => ({
        sourceOrder: index + 1,
        title: `원칙 ${index + 1}`,
        description: `${index + 1}번 한 문장 설명이다.`,
      })),
      conclusion: '결론이다.',
      takeaway: '핵심 메시지다.',
    });
    expect(markdown).toContain('**10. 원칙 10**');
    expect(markdown).not.toContain('### 1.');
    expect(validateSummaryMarkdown(markdown)).toBe(true);
  });

  it('preserves non-one source order and does not number thematic items', () => {
    expect(
      buildSummaryMarkdown({
        style: 'numbered',
        coreClaim: '주장',
        sectionTitle: '원칙',
        items: [{ sourceOrder: 3, title: '세 번째', description: '설명이다.' }],
        conclusion: '',
        takeaway: '',
      }),
    ).toContain('**3. 세 번째**');
    const thematic = buildSummaryMarkdown({
      style: 'thematic',
      coreClaim: '주장',
      sectionTitle: '차이',
      items: [{ sourceOrder: null, title: '장점', description: '설명이다.' }],
      conclusion: '',
      takeaway: '',
    });
    expect(thematic).toContain('**장점**');
    expect(thematic).not.toContain('**1. 장점**');
  });

  it('keeps short summaries plain and omits empty conclusion and takeaway', () => {
    const markdown = buildSummaryMarkdown({
      style: 'short',
      coreClaim: '짧은 주장이다.\n\n근거도 짧다.',
      sectionTitle: '',
      items: [],
      conclusion: '',
      takeaway: '',
    });
    expect(markdown).not.toContain('###');
    expect(markdown).not.toContain('>');
  });

  it('renders short conclusion and takeaway as plain paragraphs', () => {
    const markdown = buildSummaryMarkdown({
      style: 'short',
      coreClaim: '짧은 주장이다.',
      sectionTitle: '',
      items: [],
      conclusion: '짧은 결론이다.',
      takeaway: '핵심 메시지다.',
    });
    expect(markdown).toBe('짧은 주장이다.\n\n짧은 결론이다.\n\n핵심 메시지다.');
    expect(markdown).not.toMatch(/###|>/);
  });

  it('rejects malformed documents and invalid numbered order', () => {
    expect(buildSummaryMarkdown(undefined)).toBeNull();
    expect(
      buildSummaryMarkdown({
        style: 'numbered',
        coreClaim: '주장',
        sectionTitle: '원칙',
        items: [
          { sourceOrder: 2, title: '둘째', description: '설명' },
          { sourceOrder: 1, title: '첫째', description: '설명' },
        ],
        conclusion: '',
        takeaway: '',
      }),
    ).toBeNull();
  });

  it('rejects invalid documents', () => {
    expect(
      buildSummaryMarkdown({
        style: 'short',
        coreClaim: '주장',
        sectionTitle: '',
        items: [{ sourceOrder: null, title: '항목', description: '설명' }],
        conclusion: '',
        takeaway: '',
      }),
    ).toBeNull();
  });
});
