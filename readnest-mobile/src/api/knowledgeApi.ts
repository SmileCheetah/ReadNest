import { request, type ArticlePage } from "./readnestApi";
import type { KnowledgePage, KnowledgeTopic } from "../data/knowledge";

export type KnowledgePageOptions = {
  search?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
};
const id = encodeURIComponent;
function query(options: KnowledgePageOptions) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 30) });
  if (options.search?.trim()) params.set("search", options.search.trim());
  if (options.cursor) params.set("cursor", options.cursor);
  return params.toString();
}

export const knowledgeApi = {
  listTopics(token: string, options: KnowledgePageOptions = {}) {
    return request<KnowledgePage<KnowledgeTopic>>(
      `/knowledge/topics?${query(options)}`,
      { token, signal: options.signal },
    );
  },
  getTopic(token: string, topicId: string, signal?: AbortSignal) {
    return request<KnowledgeTopic>(`/knowledge/topics/${id(topicId)}`, {
      token,
      signal,
    });
  },
  createTopic(token: string, input: { name: string; description?: string }) {
    return request<KnowledgeTopic>("/knowledge/topics", {
      token,
      method: "POST",
      body: input,
    });
  },
  updateTopic(
    token: string,
    topicId: string,
    input: { name: string; description?: string; expectedRevision: number },
  ) {
    return request<KnowledgeTopic>(`/knowledge/topics/${id(topicId)}`, {
      token,
      method: "PATCH",
      body: input,
    });
  },
  deleteTopic(token: string, topicId: string) {
    return request<{ deleted: boolean; id: string }>(
      `/knowledge/topics/${id(topicId)}`,
      { token, method: "DELETE" },
    );
  },
  listArticles(
    token: string,
    topicId: string,
    options: KnowledgePageOptions = {},
  ) {
    return request<ArticlePage>(
      `/knowledge/topics/${id(topicId)}/articles?${query(options)}`,
      { token, signal: options.signal },
    );
  },
  linkArticle(token: string, topicId: string, articleId: string) {
    return request<KnowledgeTopic>(
      `/knowledge/topics/${id(topicId)}/articles/${id(articleId)}`,
      { token, method: "PUT" },
    );
  },
  unlinkArticle(token: string, topicId: string, articleId: string) {
    return request<KnowledgeTopic>(
      `/knowledge/topics/${id(topicId)}/articles/${id(articleId)}`,
      { token, method: "DELETE" },
    );
  },
  articleTopics(
    token: string,
    articleId: string,
    options: KnowledgePageOptions = {},
  ) {
    return request<KnowledgePage<KnowledgeTopic>>(
      `/knowledge/articles/${id(articleId)}/topics?${query(options)}`,
      { token, signal: options.signal },
    );
  },
};
