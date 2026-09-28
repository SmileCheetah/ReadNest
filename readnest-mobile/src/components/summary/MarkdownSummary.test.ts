import { isSupportedMarkdown, parseMarkdown } from "./MarkdownSummary";
import fixtures from "../../../../fixtures/summary-markdown-contract.json";
import {
  extractSummaryPreview,
  getCollapsedBlocks,
  splitDocumentOpening,
} from "./summaryMarkdown";

describe("parseMarkdown ordered list compatibility", () => {
  it("preserves legacy numbered headings", () => {
    expect(parseMarkdown("1. **첫 번째**\n\n2. **두 번째**")).toMatchObject([
      { type: "heading", text: "1. **첫 번째**" },
      { type: "heading", text: "2. **두 번째**" },
    ]);
  });

  it("preserves ordered list markers, including lists starting at 3", () => {
    expect(parseMarkdown("2. 일반 목록\n3. 항목\n4. 항목")).toMatchObject([
      {
        type: "ol",
        items: [
          { marker: "2", text: "일반 목록" },
          { marker: "3", text: "항목" },
          { marker: "4", text: "항목" },
        ],
      },
    ]);
  });

  it("keeps heading, bullet, quote, and bold parsing intact", () => {
    expect(parseMarkdown("### 제목\n\n- **강조**\n\n> 인용")).toMatchObject([
      { type: "heading", level: 3 },
      { type: "ul", items: [{ text: "**강조**" }] },
      { type: "quote", text: "인용" },
    ]);
    expect(
      isSupportedMarkdown("### 제목\n\n**강조**\n\n- 항목\n\n> 인용"),
    ).toBe(true);
  });

  it("supports the document title used by the summary prompt", () => {
    expect(parseMarkdown("# 글의 제목\n\n본문")).toMatchObject([
      { type: "heading", level: 1, text: "글의 제목" },
      { type: "paragraph", text: "본문" },
    ]);
    expect(
      isSupportedMarkdown("# 글의 제목\n\n### 한 줄 요약\n\n**핵심**"),
    ).toBe(true);
  });
});

describe("shared Markdown contract", () => {
  it.each(fixtures)("$name", ({ markdown, valid }) => {
    expect(isSupportedMarkdown(markdown)).toBe(valid);
  });

  it("rejects non-strings and oversized documents without losing valid boundary input", () => {
    expect(isSupportedMarkdown(null)).toBe(false);
    expect(isSupportedMarkdown({ summaryMarkdown: "text" })).toBe(false);
    expect(isSupportedMarkdown("가".repeat(16000))).toBe(true);
    expect(isSupportedMarkdown("가".repeat(16001))).toBe(false);
  });
});

describe("document meaning and display boundaries", () => {
  it("preserves hard breaks while soft breaks flow naturally", () => {
    expect(
      parseMarkdown("첫 줄\n다음 문장  \n세 번째\\\n네 번째")[0].text,
    ).toBe("첫 줄 다음 문장\n세 번째\n네 번째");
    expect(
      parseMarkdown("- 항목  \n  이어지는 설명\n- 둘째")[0].items?.[0].text,
    ).toBe("항목\n이어지는 설명");
    expect(parseMarkdown("> 인용  \n> 다음 줄")[0].text).toBe("인용\n다음 줄");
  });

  it("preserves explicit markers, including parenthesis and gaps across blank lines", () => {
    expect(
      parseMarkdown("10) 첫 항목\n11) 다음 항목\n\n20. 마지막"),
    ).toMatchObject([
      {
        type: "ol",
        items: [
          { marker: "10", delimiter: ")" },
          { marker: "11", delimiter: ")" },
        ],
      },
      { type: "ol", items: [{ marker: "20", delimiter: "." }] },
    ]);
  });

  it("never skips a long middle section to show its conclusion", () => {
    const blocks = parseMarkdown(
      `# 제목\n\n도입\n\n### 긴 근거\n\n${"중요".repeat(2100)}\n\n짧은 결론`,
    );
    const collapsed = getCollapsedBlocks(blocks);
    expect(collapsed).toEqual(blocks.slice(0, 2));
    expect(collapsed.some((block) => block.text === "짧은 결론")).toBe(false);
  });

  it("keeps the first oversized heading and body together rather than a title-only preview", () => {
    const blocks = parseMarkdown(
      `# 제목\n\n### 첫 내용\n\n${"본문".repeat(2100)}\n\n### 다음 내용\n\n이후`,
    );
    expect(getCollapsedBlocks(blocks)).toEqual(blocks.slice(0, 3));
    expect(getCollapsedBlocks(parseMarkdown("본문".repeat(2100)))).toHaveLength(
      1,
    );
  });

  it("keeps a bold numbered item title with its explanation at the fold", () => {
    const blocks = parseMarkdown(
      "도입\n\n**1. 데이터**\n\n매우 긴 설명\n\n결론",
    );
    expect(getCollapsedBlocks(blocks, 8)).toEqual(blocks.slice(0, 1));
  });

  it("keeps standalone bold numbered titles separate from their following soft-break paragraph", () => {
    expect(
      parseMarkdown(
        "**1. 데이터 관리**\n저장 방식을 결정한다.\n\n**2. 운영**\\\n결과를 관찰한다.",
      ),
    ).toEqual([
      { type: "paragraph", text: "**1. 데이터 관리**" },
      { type: "paragraph", text: "저장 방식을 결정한다." },
      { type: "paragraph", text: "**2. 운영**" },
      { type: "paragraph", text: "결과를 관찰한다." },
    ]);
    expect(parseMarkdown("**주장이다.**\n이유를 설명한다.")).toEqual([
      { type: "paragraph", text: "**주장이다.** 이유를 설명한다." },
    ]);
  });

  it("separates title and introduction without duplicating or changing remaining blocks", () => {
    const blocks = parseMarkdown(
      "# 제목\n\n핵심 **주장**이다.\n\n### 근거\n\n근거다.",
    );
    const opening = splitDocumentOpening(blocks);
    expect([opening.title, opening.intro, ...opening.remainder]).toEqual(
      blocks,
    );
    expect(
      extractSummaryPreview(
        "# 제목\n\n핵심 **주장**이다.\n\n### 근거\n\n근거다.",
      ),
    ).toBe("핵심 주장이다.");
    expect(extractSummaryPreview("# 제목\n\n**핵심 주장이다.**")).toBe(
      "핵심 주장이다.",
    );
    expect(extractSummaryPreview("# 제목만")).toBe("");
  });

  it("keeps the Python contrast, causal logic and independent sections in source order", () => {
    const markdown =
      "# Python의 경쟁력\n\nPython은 **생태계**로 선택된다.\n\n### 실행 속도와 생태계\n\nC/C++과 CUDA가 고성능 연산을 담당한다.\n\n- 사람이 많다\n- 라이브러리와 자료가 많다\n\n> 빠르기 때문이 아니라 생태계 때문이다.\n\n### 한 줄 요약\n\n**네트워크 효과가 핵심이다.**";
    const blocks = parseMarkdown(markdown);
    expect(getCollapsedBlocks(blocks)).toEqual(blocks);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "ul",
      "quote",
      "heading",
      "paragraph",
    ]);
  });
});
