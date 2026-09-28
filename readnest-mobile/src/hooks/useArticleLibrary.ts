import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  ApiError,
  readnestApi,
  type ApiArticle,
  type ListArticlesOptions,
} from "../api/readnestApi";
import { mapArticleToThread } from "../api/articleMapper";
import type { ReadStatus, SavedThread } from "../data/mockThreads";
import {
  appendUniqueIds,
  createReadWriteQueue,
  isProcessing,
  mergeThread,
} from "./articleState";

type Query = {
  period: NonNullable<ListArticlesOptions["period"]>;
  readStatus?: ReadStatus;
  search: string;
};
const message = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "연결을 확인한 뒤 다시 불러와 주세요.";

export function useArticleLibrary(
  token: string | null,
  query: Query,
  archiveActive: boolean,
) {
  const [cache, setCache] = useState<Record<string, SavedThread>>({});
  const cacheRef = useRef(cache);
  const [homeIds, setHomeIds] = useState<string[]>([]);
  const [archiveIds, setArchiveIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeHasLoaded, setHomeHasLoaded] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const epoch = useRef(0);
  const activeToken = useRef(token);
  const controllers = useRef(new Set<AbortController>());
  const homeRequest = useRef(0);
  const archiveRequest = useRef(0);
  const detailRequest = useRef(0);
  const moreInFlight = useRef(false);
  const removed = useRef(new Set<string>());
  const readRevision = useRef(new Map<string, number>());
  const readIntents = useRef(
    new Map<
      string,
      { sequence: number; status: ReadStatus; pending: boolean }
    >(),
  );
  const queue = useRef(createReadWriteQueue());
  const visit = useRef({ id: "", automatic: false, manual: false });
  const retryInFlight = useRef(new Set<string>());
  const retryKeys = useRef(new Map<string, string>());
  const readQueued = useRef(new Map<string, number>());
  const fetchInFlight = useRef(new Map<string, Promise<void>>());
  const statusInFlight = useRef(new Map<string, Promise<void>>());
  const queryRef = useRef(query);
  queryRef.current = query;
  const isActive = (session: number, sessionToken: string | null) =>
    epoch.current === session && activeToken.current === sessionToken;
  const requestController = () => {
    const controller = new AbortController();
    controllers.current.add(controller);
    return controller;
  };
  const bumpRead = (id: string) =>
    readRevision.current.set(id, (readRevision.current.get(id) ?? 0) + 1);

  const receive = useCallback(
    (articles: ApiArticle[], revisions = new Map(readRevision.current)) => {
      const next = { ...cacheRef.current };
      for (const article of articles) {
        if (removed.current.has(article.id)) continue;
        const incoming = mapArticleToThread(article);
        const intent = readIntents.current.get(article.id);
        const changedSinceFetch =
          (revisions.get(article.id) ?? 0) !==
          (readRevision.current.get(article.id) ?? 0);
        const override =
          intent && (intent.pending || changedSinceFetch)
            ? intent.status
            : undefined;
        next[article.id] = mergeThread(next[article.id], incoming, override);
      }
      cacheRef.current = next;
      setCache(next);
    },
    [],
  );

  const fetchDetail = useCallback(
    async (id: string, force = false) => {
      const sessionToken = activeToken.current;
      if (!sessionToken || removed.current.has(id)) return;
      if (!force && fetchInFlight.current.has(id))
        return fetchInFlight.current.get(id);
      const session = epoch.current;
      const revisions = new Map(readRevision.current);
      const controller = requestController();
      const task = (async () => {
        try {
          const article = await readnestApi.getArticle(
            sessionToken,
            id,
            controller.signal,
          );
          if (!isActive(session, sessionToken) || controller.signal.aborted)
            return;
          receive([article], revisions);
          if (selectedRef.current === id) setDetailError(null);
          setSyncError(null);
        } catch (error) {
          if (!isActive(session, sessionToken) || controller.signal.aborted)
            return;
          if (error instanceof ApiError && error.status === 404) {
            removed.current.add(id);
            if (selectedRef.current === id)
              setDetailError(
                "이 저장글을 찾을 수 없어요. 목록으로 돌아가 주세요.",
              );
          } else {
            setSyncError(
              "상태를 확인하지 못했어요. 연결되면 자동으로 다시 확인합니다.",
            );
            if (selectedRef.current === id) setDetailError(message(error));
          }
        } finally {
          controllers.current.delete(controller);
        }
      })();
      fetchInFlight.current.set(id, task);
      void task.finally(() => {
        if (fetchInFlight.current.get(id) === task)
          fetchInFlight.current.delete(id);
      });
      return task;
    },
    [receive],
  );

  const fetchStatus = useCallback(
    async (id: string) => {
      const sessionToken = activeToken.current;
      if (!sessionToken || removed.current.has(id)) return;
      if (statusInFlight.current.has(id)) return statusInFlight.current.get(id);
      const session = epoch.current;
      const controller = requestController();
      const task = (async () => {
        try {
          const status = await readnestApi.getSummaryStatus(
            sessionToken,
            id,
            controller.signal,
          );
          if (
            !isActive(session, sessionToken) ||
            controller.signal.aborted ||
            removed.current.has(id)
          )
            return;
          const current = cacheRef.current[id];
          if (!current) return;
          const {
            processStatus,
            generation,
            resultGeneration,
            generatedAt,
            stage,
            errorCode,
            retryable,
            retryAfterSeconds,
            lastSummaryError,
            updatedAt,
            sourceCompleteness,
            summaryPreview,
          } = status;
          const fields = Object.fromEntries(
            Object.entries({
              processStatus,
              generation,
              resultGeneration,
              generatedAt,
              stage,
              errorCode,
              retryable,
              retryAfterSeconds,
              lastSummaryError,
              updatedAt,
              sourceCompleteness,
              summaryPreview,
            }).filter(([, value]) => value !== undefined),
          );
          const next = mergeThread(current, {
            ...current,
            ...fields,
            detailLoaded: false,
          });
          cacheRef.current = { ...cacheRef.current, [id]: next };
          setCache(cacheRef.current);
          setSyncError(null);
          if (
            !isProcessing(next) ||
            (resultGeneration !== undefined &&
              resultGeneration !== current.resultGeneration)
          ) {
            await fetchDetail(id);
          }
        } catch (error) {
          if (!isActive(session, sessionToken) || controller.signal.aborted)
            return;
          if (error instanceof ApiError && error.status === 404)
            removed.current.add(id);
          else
            setSyncError(
              "상태를 확인하지 못했어요. 연결되면 자동으로 다시 확인합니다.",
            );
        } finally {
          controllers.current.delete(controller);
        }
      })();
      statusInFlight.current.set(id, task);
      void task.finally(() => {
        if (statusInFlight.current.get(id) === task)
          statusInFlight.current.delete(id);
      });
      return task;
    },
    [fetchDetail],
  );

  const refreshHome = useCallback(async () => {
    const sessionToken = activeToken.current;
    if (!sessionToken) return;
    const session = epoch.current;
    const request = ++homeRequest.current;
    const controller = requestController();
    const revisions = new Map(readRevision.current);
    setHomeLoading(true);
    setHomeError(null);
    try {
      const page = await readnestApi.listArticlePage(sessionToken, {
        limit: 30,
        signal: controller.signal,
      });
      if (
        !isActive(session, sessionToken) ||
        request !== homeRequest.current ||
        controller.signal.aborted
      )
        return;
      receive(page.items, revisions);
      setHomeIds(
        page.items
          .filter((item) => !removed.current.has(item.id))
          .map((item) => item.id),
      );
      setHomeHasLoaded(true);
    } catch (error) {
      if (
        isActive(session, sessionToken) &&
        request === homeRequest.current &&
        !controller.signal.aborted
      )
        setHomeError(message(error));
    } finally {
      controllers.current.delete(controller);
      if (isActive(session, sessionToken) && request === homeRequest.current)
        setHomeLoading(false);
    }
  }, [receive]);

  const refreshArchive = useCallback(
    async (more = false) => {
      const sessionToken = activeToken.current;
      if (
        !sessionToken ||
        (more && (moreInFlight.current || !cursorRef.current))
      )
        return;
      const session = epoch.current;
      const request = more ? archiveRequest.current : ++archiveRequest.current;
      const controller = requestController();
      const revisions = new Map(readRevision.current);
      const requestQuery = { ...queryRef.current };
      const cursor = more ? (cursorRef.current ?? undefined) : undefined;
      if (more) {
        moreInFlight.current = true;
        setLoadingMore(true);
      } else {
        setArchiveLoading(true);
        setArchiveError(null);
      }
      try {
        const page = await readnestApi.listArticlePage(sessionToken, {
          ...requestQuery,
          limit: 30,
          cursor,
          signal: controller.signal,
        });
        if (
          !isActive(session, sessionToken) ||
          request !== archiveRequest.current ||
          controller.signal.aborted
        )
          return;
        receive(page.items, revisions);
        const ids = page.items
          .filter((item) => !removed.current.has(item.id))
          .map((item) => item.id);
        setArchiveIds((current) =>
          more ? appendUniqueIds(current, ids) : ids,
        );
        cursorRef.current = page.nextCursor;
        setNextCursor(page.nextCursor);
        setArchiveError(null);
      } catch (error) {
        if (
          isActive(session, sessionToken) &&
          request === archiveRequest.current &&
          !controller.signal.aborted
        )
          setArchiveError(message(error));
      } finally {
        controllers.current.delete(controller);
        if (
          isActive(session, sessionToken) &&
          request === archiveRequest.current
        ) {
          setArchiveLoading(false);
          setLoadingMore(false);
          moreInFlight.current = false;
        }
      }
    },
    [receive],
  );

  useEffect(() => {
    activeToken.current = token;
    epoch.current += 1;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    fetchInFlight.current.clear();
    statusInFlight.current.clear();
    cacheRef.current = {};
    setCache({});
    setHomeIds([]);
    setArchiveIds([]);
    selectedRef.current = null;
    setSelectedId(null);
    removed.current.clear();
    readRevision.current.clear();
    readIntents.current.clear();
    queue.current = createReadWriteQueue();
    retryInFlight.current.clear();
    retryKeys.current.clear();
    readQueued.current.clear();
    visit.current = { id: "", automatic: false, manual: false };
    cursorRef.current = null;
    setNextCursor(null);
    moreInFlight.current = false;
    setHomeError(null);
    setArchiveError(null);
    setDetailError(null);
    setSyncError(null);
    setHomeLoading(false);
    setHomeHasLoaded(false);
    setArchiveLoading(false);
    setLoadingMore(false);
    setDetailLoading(false);
    if (token) void refreshHome();
    return () => {
      epoch.current += 1;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, [token, refreshHome]);

  useEffect(() => {
    ++archiveRequest.current;
    cursorRef.current = null;
    setNextCursor(null);
    moreInFlight.current = false;
    setLoadingMore(false);
    setArchiveIds([]);
    setArchiveError(null);
    if (!token || !archiveActive) return;
    setArchiveLoading(true);
    const timer = setTimeout(() => void refreshArchive(), 250);
    return () => clearTimeout(timer);
  }, [
    token,
    archiveActive,
    query.period,
    query.readStatus,
    query.search,
    refreshArchive,
  ]);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let foreground =
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    const poll = async () => {
      if (stopped || !foreground || polling) return;
      polling = true;
      try {
        const pending = Object.values(cacheRef.current).filter(
          (item) =>
            (isProcessing(item) || item.documentStale) &&
            !removed.current.has(item.id),
        );
        // Limit simultaneous network calls; the same article has one polling owner.
        for (
          let index = 0;
          index < pending.length && !stopped && foreground;
          index += 4
        ) {
          await Promise.all(
            pending
              .slice(index, index + 4)
              .map((item) =>
                item.documentStale
                  ? fetchDetail(item.id)
                  : fetchStatus(item.id),
              ),
          );
        }
      } finally {
        polling = false;
        if (!stopped && foreground) timer = setTimeout(() => void poll(), 2500);
      }
    };
    void poll();
    const subscription = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      if (timer) clearTimeout(timer);
      if (!foreground) {
        for (const controller of controllers.current) controller.abort();
      }
      if (foreground) {
        void refreshHome();
        if (archiveActive) void refreshArchive();
        if (selectedRef.current) void fetchDetail(selectedRef.current);
        void poll();
      }
    });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [
    token,
    archiveActive,
    fetchDetail,
    fetchStatus,
    refreshHome,
    refreshArchive,
  ]);

  useEffect(() => {
    if (selectedId && cache[selectedId]?.documentStale)
      void fetchDetail(selectedId);
  }, [selectedId, cache, fetchDetail]);

  const open = useCallback(
    async (thread: SavedThread) => {
      const request = ++detailRequest.current;
      selectedRef.current = thread.id;
      setSelectedId(thread.id);
      visit.current = { id: thread.id, automatic: false, manual: false };
      setDetailError(null);
      setDetailLoading(!cacheRef.current[thread.id]?.detailLoaded);
      await fetchDetail(thread.id);
      if (
        request === detailRequest.current &&
        selectedRef.current === thread.id
      )
        setDetailLoading(false);
    },
    [fetchDetail],
  );
  const close = useCallback(() => {
    ++detailRequest.current;
    selectedRef.current = null;
    setSelectedId(null);
    setDetailLoading(false);
  }, []);

  const changeRead = useCallback(
    async (
      thread: SavedThread,
      status: ReadStatus,
      automatic = false,
      recovery = false,
    ) => {
      const sessionToken = activeToken.current;
      if (!sessionToken) return;
      if (automatic) {
        if (
          visit.current.id !== thread.id ||
          visit.current.automatic ||
          visit.current.manual ||
          thread.readStatus !== "UNREAD"
        )
          return;
        visit.current.automatic = true;
      } else if (!recovery && visit.current.id === thread.id)
        visit.current.manual = true;
      const session = epoch.current;
      const sequence = (readIntents.current.get(thread.id)?.sequence ?? 0) + 1;
      readIntents.current.set(thread.id, { sequence, status, pending: true });
      bumpRead(thread.id);
      readQueued.current.set(
        thread.id,
        (readQueued.current.get(thread.id) ?? 0) + 1,
      );
      const current = cacheRef.current[thread.id];
      if (current) {
        cacheRef.current = {
          ...cacheRef.current,
          [thread.id]: { ...current, readStatus: status },
        };
        setCache(cacheRef.current);
      }
      try {
        const article = await queue.current.run(thread.id, async () => {
          if (
            !isActive(session, sessionToken) ||
            removed.current.has(thread.id)
          )
            return null;
          return readnestApi.updateReadStatus(sessionToken, thread.id, status);
        });
        if (!article || !isActive(session, sessionToken)) return;
        const latest = readIntents.current.get(thread.id);
        if (latest?.sequence !== sequence) return;
        latest.pending = false;
        bumpRead(thread.id);
        receive([article]);
        setSyncError(null);
      } catch (error) {
        if (
          !isActive(session, sessionToken) ||
          readIntents.current.get(thread.id)?.sequence !== sequence
        )
          return;
        // A failed response may still have committed: keep the last intent, never roll back a newer one.
        setSyncError(
          "읽음 상태를 저장하지 못했어요. 연결되면 마지막 선택으로 다시 저장합니다.",
        );
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429
        ) {
          const intent = readIntents.current.get(thread.id);
          if (intent) intent.pending = false;
          bumpRead(thread.id);
          await fetchDetail(thread.id, true);
        }
        if (!automatic && !recovery) throw error;
      } finally {
        if (isActive(session, sessionToken))
          readQueued.current.set(
            thread.id,
            Math.max(0, (readQueued.current.get(thread.id) ?? 1) - 1),
          );
      }
    },
    [receive, fetchDetail],
  );

  useEffect(() => {
    if (!token) return;
    const reconcile = () => {
      if (
        AppState.currentState === "background" ||
        AppState.currentState === "inactive"
      )
        return;
      let remaining = 4;
      for (const [id, intent] of readIntents.current) {
        const thread = cacheRef.current[id];
        if (
          thread &&
          intent.pending &&
          !readQueued.current.get(id) &&
          !removed.current.has(id)
        ) {
          void changeRead(thread, intent.status, false, true);
          if (--remaining === 0) break;
        }
      }
    };
    const timer = setInterval(reconcile, 15000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reconcile();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [token, changeRead]);

  const acceptCreated = useCallback(
    (article: ApiArticle) => {
      receive([article]);
      setHomeIds((current) => [
        article.id,
        ...current.filter((id) => id !== article.id),
      ]);
      if (archiveActive) void refreshArchive();
    },
    [receive, archiveActive, refreshArchive],
  );

  const retry = useCallback(
    async (thread: SavedThread) => {
      const sessionToken = activeToken.current;
      if (
        !sessionToken ||
        retryInFlight.current.has(thread.id) ||
        isProcessing(cacheRef.current[thread.id] ?? thread)
      )
        return;
      const session = epoch.current;
      retryInFlight.current.add(thread.id);
      const key =
        retryKeys.current.get(thread.id) ??
        "summary-" +
          Date.now().toString(36) +
          "-" +
          Math.random().toString(36).slice(2);
      retryKeys.current.set(thread.id, key);
      try {
        const article = await readnestApi.retrySummary(
          sessionToken,
          thread.id,
          key,
        );
        if (isActive(session, sessionToken)) {
          receive([article]);
          retryKeys.current.delete(thread.id);
        }
      } catch (error) {
        if (!isActive(session, sessionToken)) return;
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          retryKeys.current.delete(thread.id);
          if (
            error.status === 429 &&
            error.retryAfterSeconds &&
            cacheRef.current[thread.id]
          ) {
            cacheRef.current = {
              ...cacheRef.current,
              [thread.id]: {
                ...cacheRef.current[thread.id],
                retryAfterSeconds: error.retryAfterSeconds,
              },
            };
            setCache(cacheRef.current);
          }
        }
        throw error;
      } finally {
        if (isActive(session, sessionToken))
          retryInFlight.current.delete(thread.id);
      }
    },
    [receive],
  );

  const remove = useCallback(
    async (thread: SavedThread) => {
      const sessionToken = activeToken.current;
      if (!sessionToken) return;
      const session = epoch.current;
      await readnestApi.deleteArticle(sessionToken, thread.id);
      if (!isActive(session, sessionToken)) return;
      removed.current.add(thread.id);
      setHomeIds((current) => current.filter((id) => id !== thread.id));
      setArchiveIds((current) => current.filter((id) => id !== thread.id));
      if (selectedRef.current === thread.id) close();
    },
    [close],
  );

  const homeThreads = useMemo(
    () => homeIds.map((id) => cache[id]).filter(Boolean),
    [cache, homeIds],
  );
  const archiveThreads = useMemo(
    () =>
      archiveIds
        .map((id) => cache[id])
        .filter(
          (item) =>
            item && (!query.readStatus || item.readStatus === query.readStatus),
        ),
    [cache, archiveIds, query.readStatus],
  );
  return {
    homeThreads,
    archiveThreads,
    selectedThread: selectedId ? (cache[selectedId] ?? null) : null,
    homeLoading,
    homeHasLoaded,
    archiveLoading,
    loadingMore,
    detailLoading,
    homeError,
    archiveError,
    detailError,
    syncError,
    nextCursor,
    open,
    close,
    refreshHome,
    refreshArchive,
    fetchDetail,
    changeRead,
    acceptCreated,
    retry,
    remove,
  };
}
