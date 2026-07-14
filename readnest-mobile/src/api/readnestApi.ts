import type { ReadStatus } from "../data/mockThreads";

declare const __DEV__: boolean;

const LOCAL_API_BASE_URL = "http://localhost:3000/api";
const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

if (!configuredApiBaseUrl && !__DEV__) {
  throw new Error(
    "EXPO_PUBLIC_API_BASE_URL is required for ReadNest release builds.",
  );
}

export const API_BASE_URL = (
  configuredApiBaseUrl || LOCAL_API_BASE_URL
).replace(/\/+$/, "");

export type ApiUser = {
  id: string;
  email: string;
  nickname: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthResponse = {
  accessToken: string;
  user: ApiUser;
};

export type ApiSummaryMeta = {
  summaryType: string;
  title: string;
  oneLineSummary: string;
  coreSummary: string;
  keyPoints: string[];
  tags: string[];
  readingValue: string;
  caution: string;
  contextStatus: string;
  threadStatus: string;
  confidence: number;
};

export type ApiArticle = {
  id: string;
  source: "THREADS";
  url: string;
  normalizedUrl: string;
  title: string | null;
  author: string | null;
  rawText: string | null;
  summary: string | null;
  summaryMeta: ApiSummaryMeta | null;
  keyPoints: string[] | null;
  tags: string[] | null;
  extractionStatus: string | null;
  extractionConfidence: number | null;
  summaryRetryCount: number;
  lastSummaryError: string | null;
  processStatus:
    | "SAVED"
    | "SUMMARIZING"
    | "SUMMARY_DONE"
    | "SUMMARY_FAILED"
    | "CONTEXT_INSUFFICIENT";
  readStatus: "UNREAD" | "READ" | "READ_LATER";
  savedAt: string;
  createdAt: string;
  updatedAt: string;
  threadParts?: Array<{
    id: string;
    partNumber: number;
    totalParts: number;
    threadGroup?: {
      id: string;
      status: "PARTIAL" | "COMPLETE" | "MERGED_SUMMARY_DONE";
    };
  }>;
};

export type ApiHome = {
  todayReading: ApiArticle[];
  summarizing: ApiArticle[];
  today: ApiArticle[];
  unreadCount: number;
  weekSavedCount: number;
};

type RequestOptions = {
  token?: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export type ListArticlesOptions = {
  period?: "today" | "week" | "last-week" | "month" | "all";
  readStatus?: "UNREAD" | "READ" | "READ_LATER";
  processStatus?:
    | "SAVED"
    | "SUMMARIZING"
    | "SUMMARY_DONE"
    | "SUMMARY_FAILED"
    | "CONTEXT_INSUFFICIENT";
  search?: string;
  limit?: number;
};

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof data?.message === "string"
        ? data.message
        : Array.isArray(data?.message)
          ? data.message.join("\n")
          : "요청을 처리하지 못했습니다.";

    throw new Error(message);
  }

  return data as T;
}

export const readnestApi = {
  signup(input: { email: string; password: string; nickname: string }) {
    return request<AuthResponse>("/auth/signup", {
      method: "POST",
      body: input,
    });
  },

  login(input: { email: string; password: string }) {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: input,
    });
  },

  me(token: string) {
    return request<ApiUser>("/auth/me", {
      token,
    });
  },

  listArticles(token: string, options: ListArticlesOptions = {}) {
    const params = new URLSearchParams({
      period: options.period ?? "all",
      limit: String(options.limit ?? 50),
    });

    if (options.readStatus) {
      params.set("readStatus", options.readStatus);
    }

    if (options.processStatus) {
      params.set("processStatus", options.processStatus);
    }

    if (options.search?.trim()) {
      params.set("search", options.search.trim());
    }

    return request<ApiArticle[]>(`/articles?${params.toString()}`, {
      token,
    });
  },

  getHome(token: string) {
    return request<ApiHome>("/articles/home", {
      token,
    });
  },

  createArticle(token: string, input: { url: string; title?: string }) {
    return request<ApiArticle>("/articles", {
      token,
      method: "POST",
      body: input,
    });
  },

  getArticle(token: string, articleId: string) {
    return request<ApiArticle>(`/articles/${articleId}`, {
      token,
    });
  },

  updateReadStatus(token: string, articleId: string, readStatus: ReadStatus) {
    return request<ApiArticle>(`/articles/${articleId}/read-status`, {
      token,
      method: "PATCH",
      body: { readStatus },
    });
  },

  deleteArticle(token: string, articleId: string) {
    return request<{ deleted: boolean; id: string }>(`/articles/${articleId}`, {
      token,
      method: "DELETE",
    });
  },

  retrySummary(token: string, articleId: string) {
    return request<ApiArticle>(`/articles/${articleId}/summary/retry`, {
      token,
      method: "POST",
    });
  },
};
