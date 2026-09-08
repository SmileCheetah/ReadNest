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
