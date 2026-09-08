import { getSummaryPresentation } from "./summaryPresentation";

describe("getSummaryPresentation", () => {
  it("prioritizes active and failed processing states", () => {
    expect(getSummaryPresentation("SAVED", false)).toBe("summarizing");
    expect(getSummaryPresentation("SUMMARIZING", true)).toBe("summarizing");
    expect(getSummaryPresentation("SUMMARY_FAILED", true)).toBe("failed");
  });

  it("shows only valid V2 summaries as completed content", () => {
    expect(getSummaryPresentation("SUMMARY_DONE", true)).toBe("v2");
    expect(getSummaryPresentation("CONTEXT_INSUFFICIENT", true)).toBe("v2");
  });

  it("treats completed V1 data as a legacy summary requiring regeneration", () => {
    expect(getSummaryPresentation("SUMMARY_DONE", false)).toBe("legacy");
    expect(getSummaryPresentation("CONTEXT_INSUFFICIENT", false)).toBe(
      "legacy",
    );
  });
});
