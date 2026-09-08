import type { ProcessStatus } from "../../data/mockThreads";

export type SummaryPresentation =
  | "summarizing"
  | "failed"
  | "ready"
  | "missing";

export function getSummaryPresentation(
  processStatus: ProcessStatus,
  hasSummaryMarkdown: boolean,
): SummaryPresentation {
  if (processStatus === "SUMMARIZING" || processStatus === "SAVED") {
    return "summarizing";
  }
  if (processStatus === "SUMMARY_FAILED") return "failed";
  return hasSummaryMarkdown ? "ready" : "missing";
}
