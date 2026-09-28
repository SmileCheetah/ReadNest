export type MarkdownListItem = {
  marker?: string;
  delimiter?: string;
  text: string;
};
export type MarkdownBlock = {
  type: "heading" | "paragraph" | "ul" | "ol" | "quote";
  level?: number;
  text?: string;
  items?: MarkdownListItem[];
};

// Keep this acceptance contract aligned with the backend's fixture tests.
export function isSupportedMarkdown(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const markdown = value.trim();
  if (!markdown || markdown.length > 16000) return false;
  if (/<\/?[a-z][^>]*>|```/i.test(markdown)) return false;
  if (/^\s*\|.*\|\s*$/m.test(markdown) || /^\s*[-:]+\s*\|/m.test(markdown))
    return false;
  if (/\[[^\]]+\]\([^)]+\)/i.test(markdown)) return false;
  if (/^#{4,}(?:\s|$)/m.test(markdown)) return false;
  return true;
}

/** Soft breaks flow as text; Markdown's two-space/backslash hard breaks remain newlines. */
export function joinMarkdownLines(lines: string[]): string {
  return lines
    .map((line, index) => {
      const hardBreak = /(?: {2,}|\\)$/.test(line);
      const text = line.replace(/(?: {2,}|\\)$/, "").trim();
      return text + (index === lines.length - 1 ? "" : hardBreak ? "\n" : " ");
    })
    .join("");
}

export function markdownToPlainText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\\([\\*_[\]`])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: {
    type: "ul" | "ol";
    items: MarkdownListItem[];
    lines: string[];
  } | null = null;
  let quote: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length)
      blocks.push({ type: "paragraph", text: joinMarkdownLines(paragraph) });
    paragraph = [];
  };
  const flushListItem = () => {
    if (list?.lines.length)
      list.items[list.items.length - 1].text = joinMarkdownLines(list.lines);
    if (list) list.lines = [];
  };
  const flushList = () => {
    flushListItem();
    if (list) blocks.push({ type: list.type, items: list.items });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length)
      blocks.push({ type: "quote", text: joinMarkdownLines(quote) });
    quote = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const numberedHeading = line.match(/^(\d+)\.\s+(\*\*[^*]+\*\*)$/);
    if (heading || numberedHeading) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({
        type: "heading",
        level: heading ? heading[1].length : 3,
        text: heading
          ? heading[2]
          : `${numberedHeading![1]}. ${numberedHeading![2]}`,
      });
      continue;
    }
    // Summary output often uses a bold numbered title followed by a soft break.
    // Treat that exact standalone title as a block, not part of its explanation.
    const itemHeading = line.match(/^(\*\*\d+[.)]\s+[^*\n]{1,120}\*\*)\\?$/);
    if (itemHeading) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({ type: "paragraph", text: itemHeading[1] });
      continue;
    }
    const ordered = raw.trimStart().match(/^(\d+)([.)])\s+(.+)$/);
    const unordered = raw.trimStart().match(/^[-*•]\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      flushQuote();
      const type = ordered ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [], lines: [] };
      }
      flushListItem();
      const text = ordered ? ordered[3] : unordered![1];
      list.items.push(
        ordered
          ? { marker: ordered[1], delimiter: ordered[2], text }
          : { text },
      );
      list.lines.push(text);
      continue;
    }
    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      quote.push(raw.trimStart().replace(/^>\s?/, ""));
      continue;
    }
    // Indented continuation belongs to the preceding item, including hard breaks.
    if (list && /^\s{2,}\S/.test(raw)) {
      list.lines.push(raw.trimStart());
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(raw.trimStart());
  }
  flushParagraph();
  flushList();
  flushQuote();
  return blocks;
}

export function isHeadingBlock(block: MarkdownBlock) {
  return (
    block.type === "heading" ||
    (block.type === "paragraph" &&
      /^\*\*\d+[.)]\s+[^*\n]+\*\*$/.test(block.text ?? ""))
  );
}

/** Never skip an oversized middle block or leave a section heading without its body. */
export function getCollapsedBlocks(
  blocks: MarkdownBlock[],
  budget = 4000,
): MarkdownBlock[] {
  const units: MarkdownBlock[][] = [];
  let pending: MarkdownBlock[] = [];
  for (const block of blocks) {
    pending.push(block);
    if (!isHeadingBlock(block)) {
      units.push(pending);
      pending = [];
    }
  }
  if (pending.length) units.push(pending);
  const visible: MarkdownBlock[] = [];
  let length = 0;
  for (const unit of units) {
    const unitLength = unit.reduce(
      (sum, block) =>
        sum +
        (block.text?.length ??
          block.items?.reduce((total, item) => total + item.text.length, 0) ??
          0),
      0,
    );
    if (visible.length && length + unitLength > budget) break;
    visible.push(...unit);
    length += unitLength;
  }
  return visible;
}

export function extractSummaryPreview(markdown: unknown): string {
  if (!isSupportedMarkdown(markdown)) return "";
  const paragraph = parseMarkdown(markdown).find(
    (block) => block.type === "paragraph" && !isHeadingBlock(block),
  );
  return paragraph ? markdownToPlainText(paragraph.text ?? "") : "";
}

export function splitDocumentOpening(blocks: MarkdownBlock[]) {
  const title =
    blocks[0]?.type === "heading" && blocks[0].level === 1
      ? blocks[0]
      : undefined;
  const start = title ? 1 : 0;
  const intro =
    blocks[start]?.type === "paragraph" && !isHeadingBlock(blocks[start])
      ? blocks[start]
      : undefined;
  return { title, intro, remainder: blocks.slice(start + (intro ? 1 : 0)) };
}
