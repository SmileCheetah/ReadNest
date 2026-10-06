import { request } from "./readnestApi";

export type ConnectedArticle = {
  id: string;
  title: string | null;
  summaryPreview: string | null;
  savedAt: string;
  processStatus: string;
  scanState: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | null;
};

export type AutoConnection = {
  id: string;
  leftArticleId: string;
  rightArticleId: string;
  relationType: "SIMILAR" | "COMPLEMENT" | "CONTRAST";
  reason: string;
  leftEvidence: string;
  rightEvidence: string;
};

export type ConnectionsResponse = {
  articles: ConnectedArticle[];
  connections: AutoConnection[];
};

export const autoConnectionsApi = {
  list(token: string, signal?: AbortSignal) {
    return request<ConnectionsResponse>("/knowledge/connections", {
      token,
      signal,
    });
  },
  scan(token: string) {
    return request<{ queued: number; remaining: number }>(
      "/knowledge/connections/scan",
      {
        token,
        method: "POST",
      },
    );
  },
  retry(token: string, articleId: string) {
    return request<{ queued: boolean }>(
      `/knowledge/connections/${encodeURIComponent(articleId)}/retry`,
      { token, method: "POST" },
    );
  },
};
