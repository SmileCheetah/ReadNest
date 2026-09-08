import { isSupportedMarkdown, parseMarkdown } from "./MarkdownSummary";

describe("parseMarkdown ordered list compatibility", () => {
  it("preserves legacy numbered headings", () => {
    expect(parseMarkdown("1. **첫 번째**\n\n2. **두 번째**")).toMatchObject([
      { type: "heading", text: "1. **첫 번째**" },
      { type: "heading", text: "2. **두 번째**" },
    ]);
  });

  it("preserves ordered list markers, including lists starting at 3", () => {
    expect(parseMarkdown("2. 일반 목록\n3. 항목\n4. 항목")).toMatchObject([
      { type: "ol", items: [{ marker: "2", text: "일반 목록" }, { marker: "3", text: "항목" }, { marker: "4", text: "항목" }] },
    ]);
  });

  it("keeps heading, bullet, quote, and bold parsing intact", () => {
    expect(parseMarkdown("### 제목\n\n- **강조**\n\n> 인용")).toMatchObject([
      { type: "heading", level: 3 },
      { type: "ul", items: [{ text: "**강조**" }] },
      { type: "quote", text: "인용" },
    ]);
    expect(isSupportedMarkdown("### 제목\n\n**강조**\n\n- 항목\n\n> 인용")).toBe(true);
  });
});
