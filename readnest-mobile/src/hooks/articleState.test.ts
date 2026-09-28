import {
  appendUniqueIds,
  createReadWriteQueue,
  mergeThread,
} from "./articleState";
import type { SavedThread } from "../data/mockThreads";

const article: SavedThread = {
  id: "a",
  title: "제목",
  summary: "# 제목\n\n이전 본문",
  summaryMeta: {
    summaryMarkdown: "# 제목\n\n이전 본문",
    summaryType: "",
    oneLineSummary: "",
    coreSummary: "",
    readingValue: "",
    caution: "",
    contextStatus: "",
    threadStatus: "",
    confidence: 0,
  },
  keyPoints: [],
  tags: [],
  savedAt: "12:00",
  savedDateLabel: "오늘",
  source: "Threads",
  processStatus: "SUMMARY_DONE",
  readStatus: "UNREAD",
  generation: 1,
  resultGeneration: 1,
  detailLoaded: true,
  updatedAt: "2026-09-29T01:00:00Z",
};

it("keeps the last document revision until the new full response arrives", () => {
  const listResponse = {
    ...article,
    generation: 2,
    resultGeneration: 2,
    summary: "",
    summaryMeta: undefined,
    detailLoaded: false,
    updatedAt: "2026-09-29T02:00:00Z",
  };
  const stale = mergeThread(article, listResponse);
  expect(stale.documentStale).toBe(true);
  expect(stale.generation).toBe(2);
  expect(stale.resultGeneration).toBe(1);
  expect(stale.summaryMeta?.summaryMarkdown).toContain("이전 본문");
  const fresh = mergeThread(stale, {
    ...listResponse,
    detailLoaded: true,
    documentStale: false,
    summaryMeta: { ...article.summaryMeta!, summaryMarkdown: "새 본문" },
  });
  expect(fresh.resultGeneration).toBe(2);
  expect(fresh.documentStale).toBe(false);
  expect(fresh.summaryMeta?.summaryMarkdown).toBe("새 본문");
});

it("rejects old generations and old snapshots without losing the last read intent", () => {
  const current = { ...article, generation: 2, readStatus: "READ" as const };
  expect(mergeThread(current, article)).toBe(current);
  const older = {
    ...current,
    title: "과거 제목",
    updatedAt: "2026-09-28T00:00:00Z",
  };
  expect(mergeThread(current, older, "READ_LATER")).toMatchObject({
    title: "제목",
    readStatus: "READ_LATER",
    generation: 2,
  });
});

it("serializes server read writes while allowing unrelated articles in parallel", async () => {
  const queue = createReadWriteQueue();
  const calls: string[] = [];
  let completeFirst!: () => void;
  const first = queue.run("a", async () => {
    calls.push("a:READ");
    await new Promise<void>((resolve) => {
      completeFirst = resolve;
    });
  });
  const second = queue.run("a", async () => {
    calls.push("a:UNREAD");
  });
  const other = queue.run("b", async () => {
    calls.push("b:READ");
  });
  await other;
  expect(calls).toEqual(["a:READ", "b:READ"]);
  completeFirst();
  await Promise.all([first, second]);
  expect(calls).toEqual(["a:READ", "b:READ", "a:UNREAD"]);
});

it("continues later user intent after a failed write and deduplicates cursor pages", async () => {
  const queue = createReadWriteQueue();
  const first = queue.run("a", async () => {
    throw new Error("offline");
  });
  const second = queue.run("a", async () => "UNREAD");
  await expect(first).rejects.toThrow("offline");
  await expect(second).resolves.toBe("UNREAD");
  expect(appendUniqueIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
});
