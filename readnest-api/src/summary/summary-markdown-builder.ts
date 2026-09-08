import { validateSummaryMarkdown } from './summary-markdown-validator';

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

export const MAX_ITEM_DESCRIPTION_LENGTH = 500;

const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const cleanParagraphs = (value: string) =>
  value
    .trim()
    .split(/\n\s*\n/)
    .map(clean)
    .filter(Boolean)
    .join('\n\n');

function isSummaryDocument(value: unknown): value is SummaryDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<SummaryDocument>;
  return (
    ['numbered', 'thematic', 'short'].includes(document.style ?? '') &&
    typeof document.coreClaim === 'string' &&
    typeof document.sectionTitle === 'string' &&
    Array.isArray(document.items) &&
    typeof document.conclusion === 'string' &&
    typeof document.takeaway === 'string' &&
    document.items.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        (typeof item.sourceOrder === 'number' || item.sourceOrder === null) &&
        typeof item.title === 'string' &&
        typeof item.description === 'string',
    )
  );
}

export function buildSummaryMarkdown(document: unknown): string | null {
  if (!isSummaryDocument(document)) return null;
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
        item.title &&
        item.description &&
        item.description.length <= MAX_ITEM_DESCRIPTION_LENGTH,
    );
  if (items.length !== document.items.length) return null;
  if (
    document.style === 'numbered' &&
    (items.length === 0 ||
      items.some(
        (item, index) =>
          !Number.isInteger(item.sourceOrder) ||
          Number(item.sourceOrder) <= 0 ||
          (index > 0 &&
            Number(item.sourceOrder) <= Number(items[index - 1].sourceOrder)),
      ))
  )
    return null;
  if (document.style === 'short' && items.length > 0) return null;

  const sectionTitle = clean(document.sectionTitle);
  if (document.style !== 'short' && items.length > 0 && !sectionTitle) {
    return null;
  }

  const conclusion = clean(document.conclusion);
  const takeaway = clean(document.takeaway);

  const blocks =
    document.style === 'short'
      ? [coreClaim, conclusion, takeaway]
      : [
          '### 핵심 주장',
          coreClaim,
          ...(items.length
            ? [
                `### ${sectionTitle}`,
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
  if (document.style !== 'short' && conclusion) {
    blocks.push('### 결론', conclusion);
  }
  if (document.style !== 'short' && takeaway) blocks.push(`> ${takeaway}`);
  const markdown = blocks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return validateSummaryMarkdown(markdown) ? markdown : null;
}
