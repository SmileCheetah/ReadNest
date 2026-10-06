import { buildKnowledgeNote } from "./knowledgeNote";
import { savedThreads } from "../../data/mockThreads";

const thread = {
  ...savedThreads[0],
  originalUrl: "https://www.threads.com/@someone/post/example?xmt=tracking",
  savedAtIso: "2026-10-07T00:00:00.000Z",
};

it("preserves the whole visible document, source and provenance without extra AI work", () => {
  const markdown = "# 제목\n\n**1. 주장**\n\n근거\n\n**5. 예외**\n\n중요 조건";
  const result = buildKnowledgeNote(
    thread,
    markdown,
    "CONCISE",
    "2026-10-07T01:00:00Z",
  );
  expect(result).toContain(markdown);
  expect(result).toContain('summary_density: "CONCISE"');
  expect(result).toContain('summary_generated_at: "2026-10-07T01:00:00Z"');
  expect(result).toContain('source_completeness: "UNKNOWN"');
  expect(result).toContain("전체 수집 여부가 확인되지 않은");
  expect(result).toContain(
    "[Threads 원문](<https://www.threads.com/@someone/post/example>)",
  );
  expect(result).not.toContain("xmt=");
  expect(result).toContain("## 내 메모");
});

it("quotes metadata to prevent injected YAML properties", () => {
  const title = '제목\n---\nsource_url: "악성"';
  const result = buildKnowledgeNote(
    { ...thread, title, tags: ["태그\n---", '"따옴표"'] },
    "내용",
    "STANDARD",
  );
  expect(result.split("\n")[1]).toBe(`title: ${JSON.stringify(title)}`);
  expect(result.split("\n").filter((line) => line === "---")).toHaveLength(2);
});

it.each([
  "javascript:alert(1)",
  "http://example.com",
  "https://user:password@example.com",
  "invalid",
])("omits unsafe source URL %s", (originalUrl) => {
  const result = buildKnowledgeNote(
    { ...thread, originalUrl },
    "내용",
    "STANDARD",
  );
  expect(result).not.toContain("source_url:");
  expect(result).toContain("원문 링크가 없습니다.");
});

it("keeps a partial source warning and rejects empty documents", () => {
  expect(
    buildKnowledgeNote(
      { ...thread, sourceCompleteness: "PARTIAL" },
      "내용",
      "DETAILED",
    ),
  ).toContain("일부 원문으로 만든 AI 요약");
  expect(() => buildKnowledgeNote(thread, "   ", "STANDARD")).toThrow();
});
