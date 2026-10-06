import type { SavedThread, SummaryDensity } from "../../data/mockThreads";

// JSON quoted strings/arrays are valid YAML values and cannot inject new properties.
const scalar = (value: string) => JSON.stringify(value);

function sourceUrl(value?: string): string | undefined {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.username || url.password) return;
    url.searchParams.delete("xmt");
    url.hash = "";
    return url.toString();
  } catch {
    return;
  }
}

/** Portable source note, not an AI-synthesized wiki or an Obsidian vault write. */
export function buildKnowledgeNote(
  thread: SavedThread,
  markdown: string,
  density: SummaryDensity,
  generatedAt?: string | null,
): string {
  if (!markdown.trim()) throw new Error("요약이 없어 노트를 만들 수 없습니다.");
  const source = sourceUrl(thread.originalUrl);
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || thread.title;
  const properties = [
    "---",
    `title: ${scalar(title)}`,
    `readnest_id: ${scalar(thread.id)}`,
    "type: source-note",
    `source_platform: ${scalar(thread.source)}`,
    ...(source ? [`source_url: ${scalar(source)}`] : []),
    `summary_density: ${scalar(density)}`,
    `source_completeness: ${scalar(thread.sourceCompleteness ?? "UNKNOWN")}`,
    ...(thread.savedAtIso ? [`saved_at: ${scalar(thread.savedAtIso)}`] : []),
    ...(generatedAt ? [`summary_generated_at: ${scalar(generatedAt)}`] : []),
    `topics: ${JSON.stringify(thread.tags)}`,
    "---",
  ].join("\n");
  const sourceNotice =
    thread.sourceCompleteness === "PARTIAL"
      ? "> 일부 원문으로 만든 AI 요약입니다. 빠진 맥락은 원문에서 확인하세요."
      : thread.sourceCompleteness === "COMPLETE"
        ? "> AI가 작성한 요약입니다. 중요한 판단은 원문과 대조하세요."
        : "> 원문 전체 수집 여부가 확인되지 않은 AI 요약입니다. 원문과 대조하세요.";
  return [
    properties,
    markdown.trim(),
    "## 출처",
    source ? `[Threads 원문](<${source}>)` : "원문 링크가 없습니다.",
    sourceNotice,
    "## 내 메모",
    "",
  ].join("\n\n");
}
