import { request } from "./readnestApi";
export type ClassificationKind = "ARTICLE" | "OPEN_SOURCE" | "UNCLASSIFIED";
export type ClassifiedArticle = {
  id: string;
  title: string | null;
  summaryPreview: string | null;
  savedAt: string;
  processStatus: string;
  sourceCompleteness: string;
  classification: null | {
    kind: ClassificationKind;
    categories: string[];
    projectName: string | null;
    useCase: string | null;
    evidence: string | null;
    userEdited: boolean;
    revision: number;
    state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  };
};
export type ClassificationPage = {
  articles: ClassifiedArticle[];
  nextCursor: string | null;
  categories: Record<"ARTICLE" | "OPEN_SOURCE", string[]>;
};
export const classificationApi = {
  list(
    token: string,
    kind: ClassificationKind,
    category?: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({ kind });
    if (category) query.set("category", category);
    if (cursor) query.set("cursor", cursor);
    return request<ClassificationPage>(`/knowledge/classifications?${query}`, {
      token,
      signal,
    });
  },
  scan(token: string) {
    return request<{ queued: number; more: boolean; pending: boolean }>(
      "/knowledge/classifications/scan",
      { token, method: "POST" },
    );
  },
  edit(
    token: string,
    articleId: string,
    body: { kind: ClassificationKind; categories: string[]; revision: number },
  ) {
    return request(
      `/knowledge/classifications/${encodeURIComponent(articleId)}`,
      { token, method: "PATCH", body },
    );
  },
  retry(token: string, articleId: string) {
    return request(
      `/knowledge/classifications/${encodeURIComponent(articleId)}/retry`,
      { token, method: "POST" },
    );
  },
};
