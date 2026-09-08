import type { ProcessStatus } from "../../data/mockThreads";

export type SummaryPresentation = "summarizing" | "failed" | "v2" | "legacy";

export function getSummaryPresentation(
  processStatus: ProcessStatus,
  hasV2Markdown: boolean,
): SummaryPresentation {
  if (processStatus === "SUMMARIZING" || processStatus === "SAVED") {
    return "summarizing";
  }
  if (processStatus === "SUMMARY_FAILED") return "failed";
  return hasV2Markdown ? "v2" : "legacy";
}
