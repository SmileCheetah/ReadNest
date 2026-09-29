import { createElement } from "react";
import { AppState } from "react-native";
import { readnestApi, type ApiArticle } from "../api/readnestApi";
import { useArticleLibrary } from "./useArticleLibrary";

const { act, create } = require("react-test-renderer");

jest.mock("../api/readnestApi", () => ({
  ApiError: class ApiError extends Error {},
  readnestApi: {
    listArticlePage: jest.fn(),
    getArticle: jest.fn(),
    getSummaryStatus: jest.fn(),
    getSummaryVariants: jest.fn(),
    requestSummaryVariant: jest.fn(),
    updateReadStatus: jest.fn(),
    retrySummary: jest.fn(),
    deleteArticle: jest.fn(),
  },
}));

const api = readnestApi as jest.Mocked<typeof readnestApi>;
const article = (
  id = "a",
  overrides: Partial<ApiArticle> = {},
): ApiArticle => ({
  id,
  source: "THREADS",
  url: "https://www.threads.com/@a/post/123",
  normalizedUrl: "123",
  title: "제목",
  author: null,
  rawText: "원문",
  summary: "# 제목\n\n실제 본문",
  summaryMeta: {
    summaryMarkdown: "# 제목\n\n실제 본문",
    title: "제목",
    summaryType: "",
    oneLineSummary: "",
    coreSummary: "",
    keyPoints: [],
    tags: [],
    readingValue: "",
    caution: "",
    contextStatus: "",
    threadStatus: "",
    confidence: 0,
  },
  keyPoints: [],
  tags: [],
  extractionStatus: null,
  extractionConfidence: null,
  summaryRetryCount: 0,
  lastSummaryError: null,
  processStatus: "SUMMARY_DONE",
  readStatus: "UNREAD",
  generation: 1,
  resultGeneration: 1,
  savedAt: "2026-09-29T01:00:00Z",
  createdAt: "2026-09-29T01:00:00Z",
  updatedAt: "2026-09-29T01:00:00Z",
  ...overrides,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
let library: ReturnType<typeof useArticleLibrary>;
let tree: any;
function Harness({
  token = "user-a",
  search = "",
  archive = false,
}: {
  token?: string;
  search?: string;
  archive?: boolean;
}) {
  library = useArticleLibrary(token, { period: "all", search }, archive);
  return null;
}
const mount = async (props = {}) => {
  await act(async () => {
    tree = create(createElement(Harness, props));
  });
};
const tick = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

it("marks the first home load only after a successful response", async () => {
  const initial = deferred<{ items: ApiArticle[]; nextCursor: null }>();
  api.listArticlePage.mockReturnValueOnce(initial.promise);
  await mount();
  expect(library.homeHasLoaded).toBe(false);
  await act(async () => initial.resolve({ items: [article()], nextCursor: null }));
  expect(library.homeHasLoaded).toBe(true);
  expect(library.homeThreads).toHaveLength(1);
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  api.listArticlePage.mockResolvedValue({
    items: [article()],
    nextCursor: null,
  });
  api.getArticle.mockResolvedValue(article());
  api.getSummaryStatus.mockResolvedValue({
    id: "a",
    processStatus: "SUMMARY_DONE",
    generation: 1,
    resultGeneration: 1,
  });
  api.updateReadStatus.mockImplementation(async (_token, id, status) =>
    article(id, { readStatus: status }),
  );
  api.requestSummaryVariant.mockResolvedValue({
    density: "CONCISE",
    sourceGeneration: 1,
    state: "PENDING",
    retryable: false,
    retryAfterSeconds: 0,
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.useRealTimers();
});

it("tracks a newly saved summary beyond the old 40-second polling limit", async () => {
  api.listArticlePage.mockResolvedValue({ items: [], nextCursor: null });
  let count = 0;
  api.getSummaryStatus.mockImplementation(async () => ({
    id: "a",
    processStatus: ++count >= 18 ? "SUMMARY_DONE" : "SUMMARIZING",
    generation: 1,
    resultGeneration: count >= 18 ? 1 : null,
  }));
  await mount();
  await act(async () =>
    library.acceptCreated(
      article("a", {
        processStatus: "SAVED",
        summary: null,
        summaryMeta: null,
        resultGeneration: null,
      }),
    ),
  );
  for (let i = 0; i < 18; i++) await tick(2500);
  expect(api.getSummaryStatus).toHaveBeenCalledTimes(18);
  expect(library.homeThreads[0].processStatus).toBe("SUMMARY_DONE");
  expect(library.homeThreads[0].summaryMeta?.summaryMarkdown).toContain(
    "실제 본문",
  );
});

it("never reopens a closed detail or accepts a previous account's response", async () => {
  await mount();
  const detail = deferred<ApiArticle>();
  api.getArticle.mockReturnValueOnce(detail.promise);
  await act(async () => {
    void library.open(library.homeThreads[0]);
  });
  await act(async () => library.close());
  await act(async () => detail.resolve(article()));
  expect(library.selectedThread).toBeNull();
  const old = deferred<{ items: ApiArticle[]; nextCursor: null }>();
  api.listArticlePage.mockReturnValueOnce(old.promise);
  await act(async () => {
    void library.refreshHome();
  });
  api.listArticlePage.mockResolvedValue({
    items: [article("other-user")],
    nextCursor: null,
  });
  await act(async () =>
    tree.update(createElement(Harness, { token: "user-b" })),
  );
  await act(async () =>
    old.resolve({ items: [article("private-user-a")], nextCursor: null }),
  );
  expect(library.homeThreads.map((item) => item.id)).toEqual(["other-user"]);
});

it("keeps manual unread intent after auto-read and serializes both server writes", async () => {
  await mount();
  await act(async () => library.open(library.homeThreads[0]));
  const first = deferred<ApiArticle>();
  api.updateReadStatus.mockReturnValueOnce(first.promise);
  await act(async () => {
    void library.changeRead(library.selectedThread!, "READ", true);
  });
  await act(async () => {
    void library.changeRead(library.selectedThread!, "UNREAD");
  });
  expect(api.updateReadStatus).toHaveBeenCalledTimes(1);
  expect(library.selectedThread?.readStatus).toBe("UNREAD");
  await act(async () => first.resolve(article("a", { readStatus: "READ" })));
  expect(api.updateReadStatus.mock.calls.map((call) => call[2])).toEqual([
    "READ",
    "UNREAD",
  ]);
  await act(async () =>
    library.changeRead(library.selectedThread!, "READ", true),
  );
  expect(library.selectedThread?.readStatus).toBe("UNREAD");
  expect(api.updateReadStatus).toHaveBeenCalledTimes(2);
});

it("ignores an older search response after filter/search changes", async () => {
  await mount({ archive: true, search: "old" });
  const oldSearch = deferred<{ items: ApiArticle[]; nextCursor: null }>();
  api.listArticlePage.mockReturnValueOnce(oldSearch.promise);
  await tick(250);
  await act(async () =>
    tree.update(createElement(Harness, { archive: true, search: "new" })),
  );
  api.listArticlePage.mockResolvedValueOnce({
    items: [article("new")],
    nextCursor: null,
  });
  await tick(250);
  await act(async () =>
    oldSearch.resolve({ items: [article("old")], nextCursor: null }),
  );
  expect(library.archiveThreads.map((item) => item.id)).toEqual(["new"]);
});

it("fetches the new document when a lightweight list completes before status polling", async () => {
  await mount();
  await act(async () => library.open(library.homeThreads[0]));
  const full = deferred<ApiArticle>();
  api.getArticle.mockReturnValueOnce(full.promise);
  const list = article("a", {
    summary: undefined,
    summaryMeta: undefined,
    generation: 2,
    resultGeneration: 2,
    updatedAt: "2026-09-29T02:00:00Z",
  });
  delete list.summaryMeta;
  api.listArticlePage.mockResolvedValueOnce({
    items: [list],
    nextCursor: null,
  });
  await act(async () => library.refreshHome());
  expect(library.selectedThread?.documentStale).toBe(true);
  expect(library.selectedThread?.resultGeneration).toBe(1);
  await act(async () =>
    full.resolve(
      article("a", {
        generation: 2,
        resultGeneration: 2,
        summaryMeta: { ...article().summaryMeta!, summaryMarkdown: "새 본문" },
        updatedAt: "2026-09-29T02:00:00Z",
      }),
    ),
  );
  expect(library.selectedThread?.documentStale).toBe(false);
  expect(library.selectedThread?.summaryMeta?.summaryMarkdown).toBe("새 본문");
});

it("reuses the same idempotency key after an uncertain retry response", async () => {
  await mount();
  api.retrySummary.mockRejectedValueOnce(new Error("network"));
  await act(async () => {
    await expect(library.retry(library.homeThreads[0])).rejects.toThrow(
      "network",
    );
  });
  api.retrySummary.mockResolvedValueOnce(
    article("a", { processStatus: "SUMMARIZING", generation: 2 }),
  );
  await act(async () => library.retry(library.homeThreads[0]));
  expect(api.retrySummary.mock.calls[0][2]).toBeTruthy();
  expect(api.retrySummary.mock.calls[1][2]).toBe(
    api.retrySummary.mock.calls[0][2],
  );
});

it("stores a requested density independently while the standard document remains", async () => {
  await mount();
  const current = library.homeThreads[0];
  await act(async () => library.requestSummaryDensity(current, "CONCISE"));

  expect(api.requestSummaryVariant).toHaveBeenCalledWith(
    "user-a",
    "a",
    "CONCISE",
    expect.stringMatching(/^density-concise-/),
  );
  expect(library.homeThreads[0].summaryMeta?.summaryMarkdown).toContain(
    "실제 본문",
  );
  expect(library.homeThreads[0].summaryVariants).toEqual([
    expect.objectContaining({ density: "CONCISE", state: "PENDING" }),
  ]);
});
