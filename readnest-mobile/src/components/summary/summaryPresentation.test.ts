import { getSummaryPresentation } from "./summaryPresentation";

describe("getSummaryPresentation", () => {
  it("prioritizes active and failed processing states", () => {
    expect(getSummaryPresentation("SAVED", false)).toBe("summarizing");
    expect(getSummaryPresentation("SUMMARIZING", true)).toBe("summarizing");
    expect(getSummaryPresentation("SUMMARY_FAILED", true)).toBe("failed");
  });

  it("shows valid Markdown summaries as completed content", () => {
    expect(getSummaryPresentation("SUMMARY_DONE", true)).toBe("ready");
    expect(getSummaryPresentation("CONTEXT_INSUFFICIENT", true)).toBe(
      "ready",
    );
  });

  it("requests generation when completed data has no Markdown summary", () => {
    expect(getSummaryPresentation("SUMMARY_DONE", false)).toBe("missing");
    expect(getSummaryPresentation("CONTEXT_INSUFFICIENT", false)).toBe(
      "missing",
    );
  });
});
