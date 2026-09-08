import { validateSummaryMarkdown } from './ai-summary.service';

export type SummaryDocument = {
  style: 'numbered' | 'thematic' | 'short';
  coreClaim: string;
  sectionTitle: string;
  items: Array<{
    sourceOrder: number | null;
    title: string;
    description: string;
  }>;
  conclusion: string;
  takeaway: string;
};

const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const cleanParagraphs = (value: string) =>
  value
    .trim()
    .split(/\n\s*\n/)
    .map(clean)
    .filter(Boolean)
    .join('\n\n');

export function buildSummaryMarkdown(document: SummaryDocument): string | null {
  const coreClaim =
    document.style === 'short'
      ? cleanParagraphs(document.coreClaim)
      : clean(document.coreClaim);
  if (!coreClaim) return null;
  const items = document.items
    .map((item) => ({
      ...item,
      title: clean(item.title),
      description: clean(item.description),
    }))
    .filter(
      (item) =>
        item.title && item.description && item.description.length <= 120,
    );
  if (items.length !== document.items.length) return null;
  if (
    document.style === 'numbered' &&
    (items.length === 0 || items.some((item) => item.sourceOrder === null))
  )
    return null;
  if (document.style === 'short' && items.length > 0) return null;

  const blocks =
    document.style === 'short'
      ? [coreClaim]
      : [
          '### 핵심 주장',
          coreClaim,
          ...(items.length
            ? [
                `### ${clean(document.sectionTitle)}`,
                ...items.map((item) => {
                  const label =
                    document.style === 'numbered'
                      ? `${item.sourceOrder}. ${item.title}`
                      : item.title;
                  return `**${label}**\n\n${item.description}`;
                }),
              ]
            : []),
        ];
  const conclusion = clean(document.conclusion);
  const takeaway = clean(document.takeaway);
  if (conclusion) blocks.push('### 결론', conclusion);
  if (takeaway) blocks.push(`> ${takeaway}`);
  const markdown = blocks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return validateSummaryMarkdown(markdown) ? markdown : null;
}
