import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgePage } from "../data/knowledge";

export function knowledgeError(error: unknown) {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  )
    return "응답이 지연되고 있어요. 연결을 확인하고 다시 시도해 주세요.";
  return error instanceof Error && error.message !== "Failed to fetch"
    ? error.message
    : "연결을 확인하고 다시 시도해 주세요.";
}

/** Each scope owns its cursor. Late results cannot cross token, topic or search boundaries. */
export function useKnowledgePage<T extends { id: string }>(
  scope: string,
  loader: (cursor?: string, signal?: AbortSignal) => Promise<KnowledgePage<T>>,
  enabled = true,
) {
  const [state, setState] = useState({
    scope,
    items: [] as T[],
    cursor: null as string | null,
    loading: enabled,
    error: null as string | null,
  });
  const current = useRef({ scope, loader, enabled });
  current.current = { scope, loader, enabled };
  const sequence = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);
  const load = useCallback(async (cursor?: string) => {
    if (!current.current.enabled || (cursor && running.current)) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const request = ++sequence.current;
    const captured = current.current;
    running.current = true;
    setState((old) => ({
      ...old,
      scope: captured.scope,
      items: cursor && old.scope === captured.scope ? old.items : [],
      cursor: cursor ?? null,
      loading: true,
      error: null,
    }));
    try {
      const page = await captured.loader(cursor, controller.signal);
      if (
        controller.signal.aborted ||
        request !== sequence.current ||
        captured.scope !== current.current.scope
      )
        return;
      setState((old) => ({
        scope: captured.scope,
        items: cursor
          ? Array.from(
              new Map(
                [...old.items, ...page.items].map((item) => [item.id, item]),
              ).values(),
            )
          : page.items,
        cursor: page.nextCursor,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (
        controller.signal.aborted ||
        request !== sequence.current ||
        captured.scope !== current.current.scope
      )
        return;
      setState((old) => ({
        ...old,
        loading: false,
        error: knowledgeError(error),
      }));
    } finally {
      if (request === sequence.current) running.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      abort.current?.abort();
      sequence.current++;
      running.current = false;
    };
  }, [scope, enabled, load]);
  const visible =
    state.scope === scope && enabled
      ? state
      : {
          scope,
          items: [] as T[],
          cursor: null,
          loading: enabled,
          error: null,
        };
  return {
    ...visible,
    reload: () => load(),
    loadMore: () => (visible.cursor ? load(visible.cursor) : Promise.resolve()),
    retry: () => load(visible.cursor ?? undefined),
  };
}

export function useKnowledgeSearch(value: string) {
  const [search, setSearch] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return search;
}
