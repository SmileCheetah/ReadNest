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
  // A new attempt must not erase the last successful document.
  if (hasSummaryMarkdown) return "ready";
  if (processStatus === "SUMMARIZING" || processStatus === "SAVED") {
    return "summarizing";
  }
  if (processStatus === "SUMMARY_FAILED") return "failed";
  return "missing";
}

export function getSummaryErrorMessage(errorCode?: string | null): string {
  switch (errorCode) {
    case "EXTRACTION_FAILED":
    case "EMPTY_SOURCE":
      return "원문을 가져오지 못했어요. 공개된 글인지 원문에서 확인해 주세요.";
    case "RATE_LIMITED":
    case "PROVIDER_RATE_LIMIT":
    case "AI_RATE_LIMIT":
    case "RETRY_COOLDOWN":
    case "RETRY_LIMIT":
      return "요약 요청이 잠시 몰렸어요. 안내된 대기 시간 뒤 다시 시도해 주세요.";
    case "PROVIDER_AUTH":
    case "PROVIDER_AUTH_FAILED":
    case "AI_AUTH_FAILED":
    case "AI_CONFIGURATION":
      return "요약 서비스 연결 설정에 문제가 있어요. 잠시 후 다시 확인해 주세요.";
    case "AI_UNAVAILABLE":
      return "AI 응답을 받지 못했어요. 잠시 후 다시 생성해 주세요.";
    case "INVALID_MARKDOWN":
    case "INVALID_OUTPUT":
      return "읽을 수 있는 요약을 만들지 못했어요. 다시 생성해 주세요.";
    case "PERSISTENCE_FAILED":
      return "요약 결과를 저장하지 못했어요. 잠시 후 다시 생성해 주세요.";
    case "WORKER_INTERRUPTED":
      return "요약 처리 연결이 끊겼어요. 다시 생성해 주세요.";
    default:
      return "이번 요약을 완료하지 못했어요. 원문을 확인하거나 다시 시도해 주세요.";
  }
}
