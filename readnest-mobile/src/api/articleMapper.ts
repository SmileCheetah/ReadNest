import type { ApiArticle } from "./readnestApi";
import type { SavedThread } from "../data/mockThreads";

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
  if (diffDays < 7) return "이번 주";
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function mapArticleToThread(article: ApiArticle): SavedThread {
  return {
    id: article.id,
    title: article.title ?? "제목을 가져오는 중",
    summary:
      article.summary ??
      "아직 요약이 생성되지 않았습니다. 요약 큐 연결 후 자동으로 채워질 예정입니다.",
    summaryMeta: article.summaryMeta
      ? {
          summaryType: article.summaryMeta.summaryType,
          oneLineSummary: article.summaryMeta.oneLineSummary,
          coreSummary: article.summaryMeta.coreSummary,
          readingValue: article.summaryMeta.readingValue,
          caution: article.summaryMeta.caution,
          contextStatus: article.summaryMeta.contextStatus,
          threadStatus: article.summaryMeta.threadStatus,
          confidence: article.summaryMeta.confidence,
        }
      : undefined,
    keyPoints: article.keyPoints ?? [
      "원문 저장 완료",
      "AI 요약 기능 연결 예정",
    ],
    tags: article.tags ?? ["Threads"],
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
