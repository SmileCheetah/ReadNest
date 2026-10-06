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
  summaryMarkdown?: string;
};

export type ApiSummaryVariant = {
  density: "CONCISE" | "DETAILED";
  sourceGeneration: number;
  state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  summaryMarkdown?: string;
  errorCode?: string | null;
  retryable: boolean;
  retryAfterSeconds: number;
  generatedAt?: string | null;
};

export type ApiArticle = {
  id: string;
  source: "THREADS";
  url: string;
  normalizedUrl: string;
  title: string | null;
  author: string | null;
  rawText?: string | null;
  summary?: string | null;
  summaryMeta?: ApiSummaryMeta | null;
  summaryPreview?: string | null;
  generation?: number;
  resultGeneration?: number | null;
  generatedAt?: string | null;
  stage?:
    | "QUEUED"
    | "EXTRACTING"
    | "GENERATING"
    | "PERSISTING"
    | "DONE"
    | "FAILED";
  errorCode?: string | null;
  retryable?: boolean;
  retryAfterSeconds?: number;
  sourceCompleteness?: "UNKNOWN" | "PARTIAL" | "COMPLETE";
  summaryVariants?: ApiSummaryVariant[];
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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ArticlePage = { items: ApiArticle[]; nextCursor: string | null };
export type ApiSummaryStatus = Pick<ApiArticle, "id" | "processStatus"> &
  Partial<
    Pick<
      ApiArticle,
      | "generation"
      | "resultGeneration"
      | "generatedAt"
      | "stage"
      | "errorCode"
      | "retryable"
      | "retryAfterSeconds"
      | "lastSummaryError"
      | "updatedAt"
      | "sourceCompleteness"
      | "summaryPreview"
    >
  >;
export type ApiSummaryVariants = {
  sourceGeneration: number | null;
  variants: ApiSummaryVariant[];
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
  signal?: AbortSignal;
};

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 20000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(
        "서버 응답을 확인하지 못했어요. 잠시 후 다시 불러와 주세요.",
        response.status,
      );
    }

    if (!response.ok) {
      const message =
        typeof data?.message === "string"
          ? data.message
          : Array.isArray(data?.message)
            ? data.message.join("\n")
            : "요청을 처리하지 못했습니다.";

      const retryAfterSeconds = Number(
        data?.retryAfterSeconds ?? response.headers.get("Retry-After"),
      );
      throw new ApiError(
        message,
        response.status,
        data?.errorCode ?? data?.code,
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds
          : undefined,
      );
    }

    return data as T;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function articleParams(options: ListArticlesOptions) {
  const params = new URLSearchParams({
    period: options.period ?? "all",
    limit: String(options.limit ?? 30),
  });
  if (options.readStatus) params.set("readStatus", options.readStatus);
  if (options.processStatus) params.set("processStatus", options.processStatus);
  if (options.search?.trim()) params.set("search", options.search.trim());
  return params;
}

export const readnestApi = {
  guest(input: { deviceId: string }) {
    return request<AuthResponse>("/auth/guest", {
      method: "POST",
      body: input,
    });
  },

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

  me(token: string, signal?: AbortSignal) {
    return request<ApiUser>("/auth/me", {
      token,
      signal,
    });
  },

  listArticles(token: string, options: ListArticlesOptions = {}) {
    const params = articleParams(options);

    return request<ApiArticle[]>(`/articles?${params.toString()}`, {
      token,
      signal: options.signal,
    });
  },

  listArticlePage(
    token: string,
    options: ListArticlesOptions & { cursor?: string } = {},
  ) {
    const params = articleParams(options);
    params.set("pagination", "cursor");
    if (options.cursor) params.set("cursor", options.cursor);
    return request<ArticlePage>(`/articles?${params.toString()}`, {
      token,
      signal: options.signal,
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

  getArticle(token: string, articleId: string, signal?: AbortSignal) {
    return request<ApiArticle>(`/articles/${articleId}`, {
      token,
      signal,
    });
  },

  getSummaryStatus(token: string, articleId: string, signal?: AbortSignal) {
    return request<ApiSummaryStatus>(`/articles/${articleId}/summary/status`, {
      token,
      signal,
    });
  },

  getSummaryVariants(token: string, articleId: string, signal?: AbortSignal) {
    return request<ApiSummaryVariants>(
      `/articles/${articleId}/summary/variants`,
      { token, signal },
    );
  },

  requestSummaryVariant(
    token: string,
    articleId: string,
    density: "CONCISE" | "DETAILED",
    idempotencyKey?: string,
  ) {
    return request<ApiSummaryVariant>(
      `/articles/${articleId}/summary/variants/${density.toLowerCase()}`,
      {
        token,
        method: "POST",
        idempotencyKey,
      },
    );
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

  retrySummary(token: string, articleId: string, idempotencyKey?: string) {
    return request<ApiArticle>(`/articles/${articleId}/summary/retry`, {
      token,
      method: "POST",
      idempotencyKey,
    });
  },
};
