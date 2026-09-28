import type { ReadStatus, SavedThread } from "../data/mockThreads";

export const isProcessing = (article: SavedThread) =>
  article.processStatus === "SAVED" || article.processStatus === "SUMMARIZING";

/** List DTOs never erase a cached document; old generations never replace a new job. */
export function mergeThread(
  current: SavedThread | undefined,
  incoming: SavedThread,
  readStatus?: ReadStatus,
): SavedThread {
  let next = incoming;
  if (current) {
    const oldGeneration =
      (incoming.generation ?? 0) < (current.generation ?? 0);
    const sameGeneration =
      (incoming.generation ?? 0) === (current.generation ?? 0);
    const oldSnapshot =
      sameGeneration &&
      current.updatedAt &&
      incoming.updatedAt &&
      Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt);
    if (oldGeneration || oldSnapshot) next = current;
    else if (
      !incoming.detailLoaded &&
      (current.detailLoaded || current.summaryMeta)
    ) {
      const changedDocument =
        incoming.resultGeneration != null &&
        incoming.resultGeneration > (current.resultGeneration ?? -1);
      next = {
        ...current,
        ...incoming,
        detailLoaded: true,
        rawText: current.rawText,
        summary: current.summary,
        summaryMeta: current.summaryMeta,
        documentStale: current.documentStale || changedDocument,
        resultGeneration: current.resultGeneration,
        generatedAt: current.generatedAt,
        summaryPreview: incoming.summaryPreview || current.summaryPreview,
      };
    }
  }
  return readStatus ? { ...next, readStatus } : next;
}

/** All writes for one article reach the server in user-intent order. */
export function createReadWriteQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(id: string, write: () => Promise<T>): Promise<T> {
      const next = (tails.get(id) ?? Promise.resolve())
        .catch(() => undefined)
        .then(write);
      tails.set(id, next);
      void next
        .finally(() => {
          if (tails.get(id) === next) tails.delete(id);
        })
        .catch(() => undefined);
      return next;
    },
  };
}

export function appendUniqueIds(current: string[], incoming: string[]) {
  return [...new Set([...current, ...incoming])];
}
