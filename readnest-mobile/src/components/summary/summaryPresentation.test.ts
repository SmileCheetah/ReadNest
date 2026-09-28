import { getSummaryPresentation } from "./summaryPresentation";

describe("getSummaryPresentation", () => {
  it("shows processing and failure states only when no successful document exists", () => {
    expect(getSummaryPresentation("SAVED", false)).toBe("summarizing");
    expect(getSummaryPresentation("SUMMARIZING", false)).toBe("summarizing");
    expect(getSummaryPresentation("SUMMARY_FAILED", false)).toBe("failed");
  });

  it("preserves the last completed document during regeneration or failure", () => {
    expect(getSummaryPresentation("SUMMARIZING", true)).toBe("ready");
    expect(getSummaryPresentation("SUMMARY_FAILED", true)).toBe("ready");
  });

  it("shows valid Markdown summaries as completed content", () => {
    expect(getSummaryPresentation("SUMMARY_DONE", true)).toBe("ready");
    expect(getSummaryPresentation("CONTEXT_INSUFFICIENT", true)).toBe("ready");
  });

  it("requests generation when completed data has no Markdown summary", () => {
    expect(getSummaryPresentation("SUMMARY_DONE", false)).toBe("missing");
    expect(getSummaryPresentation("CONTEXT_INSUFFICIENT", false)).toBe(
      "missing",
    );
  });
});
