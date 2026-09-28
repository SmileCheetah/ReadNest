import type { ApiArticle } from "./readnestApi";
import type { SavedThread } from "../data/mockThreads";
import { extractSummaryPreview } from "../components/summary/summaryMarkdown";

function formatSavedTime(savedAt: string) {
  const date = new Date(savedAt);
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSavedDateLabel(savedAt: string) {
  const date = new Date(savedAt);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfTarget = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays > 1 && diffDays < 7) return `${diffDays}일 전`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function mapArticleToThread(article: ApiArticle): SavedThread {
  return {
    id: article.id,
    title:
      article.title?.trim() ||
      (article.processStatus === "SAVED" ||
      article.processStatus === "SUMMARIZING"
        ? "제목을 가져오는 중"
        : "저장한 글"),
    rawText: article.rawText,
    summary: article.summary ?? "",
    summaryPreview:
      article.summaryPreview ??
      extractSummaryPreview(
        article.summaryMeta?.summaryMarkdown ?? article.summary,
      ),
    detailLoaded: Object.prototype.hasOwnProperty.call(article, "summaryMeta"),
    documentStale: false,
    savedAtIso: article.savedAt,
    updatedAt: article.updatedAt,
    generation: article.generation,
    resultGeneration: article.resultGeneration,
    generatedAt: article.generatedAt,
    stage: article.stage,
    errorCode: article.errorCode,
    retryable: article.retryable,
    retryAfterSeconds: article.retryAfterSeconds,
    sourceCompleteness: article.sourceCompleteness,
    summaryMeta: article.summaryMeta
      ? {
          summaryMarkdown: article.summaryMeta.summaryMarkdown,
          summaryType: article.summaryMeta.summaryType,
          title: article.summaryMeta.title,
          oneLineSummary: article.summaryMeta.oneLineSummary,
          coreSummary: article.summaryMeta.coreSummary,
          readingValue: article.summaryMeta.readingValue,
          caution: article.summaryMeta.caution,
          contextStatus: article.summaryMeta.contextStatus,
          threadStatus: article.summaryMeta.threadStatus,
          confidence: article.summaryMeta.confidence,
        }
      : undefined,
    keyPoints: article.keyPoints ?? [],
    tags: article.tags ?? [],
    extractionConfidence: article.extractionConfidence,
    summaryRetryCount: article.summaryRetryCount,
    lastSummaryError: article.lastSummaryError,
    savedAt: formatSavedTime(article.savedAt),
    savedDateLabel: getSavedDateLabel(article.savedAt),
    source: "Threads",
    originalUrl: article.url,
    processStatus: article.processStatus,
    readStatus: article.readStatus,
    threadPart: article.threadParts?.[0]
      ? {
          current: article.threadParts[0].partNumber,
          total: article.threadParts[0].totalParts,
        }
      : undefined,
  };
}
