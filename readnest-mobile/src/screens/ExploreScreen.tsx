import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  classificationApi,
  type ClassificationKind,
  type ClassifiedArticle,
  type ClassificationPage,
} from "../api/classificationApi";
import { readnestApi } from "../api/readnestApi";
import { mapArticleToThread } from "../api/articleMapper";
import type { SavedThread } from "../data/mockThreads";
import { colors, radius, spacing } from "../theme/tokens";

type Props = {
  token: string;
  active?: boolean;
  onOpenThread: (thread: SavedThread) => void;
  onOpenCollections: () => void;
};
const labels: Record<ClassificationKind, string> = {
  ARTICLE: "주제별 글",
  OPEN_SOURCE: "오픈소스",
  UNCLASSIFIED: "미분류",
};
function Action({
  label,
  accessibilityLabel = label,
  onPress,
  selected,
  disabled,
  role = "button",
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  role?: "button" | "tab" | "checkbox";
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        ...(role === "checkbox" ? { checked: selected } : { selected }),
        disabled: !!disabled,
      }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        selected && styles.selected,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionText, selected && styles.selectedText]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function ExploreScreen({
  token,
  active = true,
  onOpenThread,
  onOpenCollections,
}: Props) {
  const [section, setSection] = useState<"ARTICLE" | "OPEN_SOURCE">("ARTICLE");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState<ClassificationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [editor, setEditor] = useState<{
    article: ClassifiedArticle;
    kind: ClassificationKind;
    categories: string[];
  } | null>(null);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const paginationUsed = useRef(false);
  const editing = useRef(false);
  editing.current = !!editor;
  const kind = category === "미분류" ? "UNCLASSIFIED" : section;
  const selectedCategory =
    category && category !== "미분류" ? category : undefined;

  useEffect(() => {
    if (!active) return;
    const current = ++epoch.current;
    paginationUsed.current = false;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPage(null);
    setLoading(true);
    setError(null);
    setEditor(null);
    setMoreLoading(false);
    const load = async () => {
      if (paginationUsed.current) return;
      if (editing.current) {
        timer = setTimeout(() => void load(), 8000);
        return;
      }
      try {
        // Classification is independent from the summary. A dispatch failure must not hide saved posts.
        let pending = false;
        try {
          const scan = await classificationApi.scan(token);
          pending = scan.more || scan.pending || scan.queued > 0;
        } catch {
          if (current === epoch.current)
            setError(
              "자동 분류를 시작하지 못했어요. 저장글은 읽을 수 있으며 다시 시도할 수 있어요.",
            );
        }
        const result = await classificationApi.list(
          token,
          kind,
          selectedCategory,
          undefined,
          abort.signal,
        );
        if (current !== epoch.current) return;
        if (paginationUsed.current) return;
        setPage(result);
        pending ||= result.articles.some(
          (a) =>
            ["PENDING", "RUNNING"].includes(a.classification?.state ?? "") ||
            ["SAVED", "SUMMARIZING"].includes(a.processStatus),
        );
        setScanning(pending);
        if (pending) timer = setTimeout(() => void load(), 8000);
      } catch {
        if (current === epoch.current)
          setError(
            "분류 목록을 불러오지 못했어요. 다시 불러오기를 눌러 주세요.",
          );
      } finally {
        if (current === epoch.current) setLoading(false);
      }
    };
    void load();
    return () => {
      ++epoch.current;
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [token, active, kind, selectedCategory, refresh]);

  const run = async (id: string, task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking(id);
    setError(null);
    const current = epoch.current;
    try {
      await task();
    } catch (cause) {
      if (current === epoch.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "처리하지 못했어요. 다시 시도해 주세요.",
        );
    } finally {
      inFlight.current = false;
      setWorking(null);
    }
  };
  const loadMore = async () => {
    if (!page?.nextCursor || moreLoading) return;
    const current = epoch.current;
    paginationUsed.current = true;
    setMoreLoading(true);
    try {
      const next = await classificationApi.list(
        token,
        kind,
        selectedCategory,
        page.nextCursor,
      );
      if (current === epoch.current)
        setPage((previous) =>
          previous
            ? {
                ...next,
                articles: [
                  ...previous.articles,
                  ...next.articles.filter(
                    (a) => !previous.articles.some((b) => a.id === b.id),
                  ),
                ],
              }
            : next,
        );
    } catch {
      if (current === epoch.current)
        setError("다음 글을 불러오지 못했어요. 더 보기를 다시 눌러 주세요.");
    } finally {
      if (current === epoch.current) setMoreLoading(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={styles.title}>
        관심사 탐색
      </Text>
      <Text style={styles.description}>
        글은 주제별로, 오픈소스는 쓸모별로 자동 정리됩니다.
      </Text>
      <View style={styles.row}>
        <Action
          label="내 모음"
          accessibilityLabel="내가 만든 모음"
          onPress={onOpenCollections}
        />
        <Action
          label="새로고침"
          disabled={!!working || loading}
          onPress={() => setRefresh((v) => v + 1)}
        />
      </View>
      <View style={styles.tabs}>
        {(["ARTICLE", "OPEN_SOURCE"] as const).map((value) => (
          <Action
            key={value}
            role="tab"
            label={labels[value]}
            selected={section === value}
            onPress={() => {
              setSection(value);
              setCategory("");
            }}
          />
        ))}
      </View>
      <Text style={styles.description}>
        {section === "OPEN_SOURCE"
          ? "프로젝트를 용도별로 찾아보세요. 라이선스는 원문에서 확인해 주세요."
          : "관심 있는 주제를 고르세요. 하나의 글은 여러 주제에서 볼 수 있어요."}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.categoryRow}
        accessibilityLabel="주제 필터"
      >
        {[
          "전체",
          ...(page?.categories[section] ?? []),
          ...(section === "ARTICLE" ? ["미분류"] : []),
        ].map((value) => (
          <Action
            key={value}
            label={value}
            selected={(category || "전체") === value}
            onPress={() => setCategory(value === "전체" ? "" : value)}
          />
        ))}
      </ScrollView>
      {scanning ? (
        <Text accessibilityLiveRegion="polite" style={styles.meta}>
          저장한 글을 순서대로 분류하고 있어요. 요약은 바로 읽을 수 있어요.
        </Text>
      ) : null}
      {error ? (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={styles.body}>{error}</Text>
          <Action
            label="다시 불러오기"
            onPress={() => setRefresh((v) => v + 1)}
          />
        </View>
      ) : null}
      {loading ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.meta}>분류 목록 불러오는 중…</Text>
        </View>
      ) : null}
      {!loading && page && !page.articles.length ? (
        <View style={styles.empty}>
          <Ionicons
            name={
              section === "OPEN_SOURCE" ? "code-slash-outline" : "book-outline"
            }
            size={28}
            color={colors.muted}
          />
          <Text style={styles.heading}>
            {section === "OPEN_SOURCE"
              ? "아직 분류된 오픈소스가 없어요"
              : "아직 이 주제에 글이 없어요"}
          </Text>
          <Text style={styles.body}>
            홈에서 링크를 저장하면 요약 후 자동으로 분류해 드려요. 분류되지 않은
            글은 ‘미분류’에서 확인할 수 있어요.
          </Text>
        </View>
      ) : null}
      {page?.articles.map((article) => {
        const result = article.classification;
        return (
          <View key={article.id} style={styles.article}>
            <Text style={styles.meta}>
              {result?.userEdited
                ? "내가 수정한 분류"
                : result?.state === "FAILED"
                  ? "분류 실패 · 요약은 그대로 유지됩니다"
                  : result?.state === "SUCCEEDED"
                    ? result.kind === "UNCLASSIFIED"
                      ? "분류 근거 부족"
                      : "자동 분류"
                    : article.processStatus === "SUMMARY_FAILED"
                      ? "요약 후 분류할 수 있어요"
                      : "분류 대기 중"}
              {result?.categories.length
                ? ` · ${result.categories.join(" · ")}`
                : ""}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${article.title || "저장한 글"} 읽기`}
              disabled={!!working}
              style={styles.read}
              onPress={() =>
                void run(article.id, async () => {
                  const current = epoch.current;
                  const data = await readnestApi.getArticle(token, article.id);
                  if (current === epoch.current)
                    onOpenThread(mapArticleToThread(data));
                })
              }
            >
              <Text style={styles.heading}>
                {result?.projectName || article.title || "저장한 글"}
              </Text>
              <Text numberOfLines={3} style={styles.body}>
                {result?.useCase ||
                  article.summaryPreview ||
                  "요약을 준비하고 있어요."}
              </Text>
            </Pressable>
            {article.sourceCompleteness === "PARTIAL" ? (
              <Text style={styles.meta}>
                수집된 원문 일부를 기준으로 분류했어요.
              </Text>
            ) : null}
            <View style={styles.row}>
              <Action
                label="분류 수정"
                accessibilityLabel={`${article.title || "글"} 분류 수정`}
                disabled={!!working}
                onPress={() =>
                  setEditor({
                    article,
                    kind: result?.kind ?? "UNCLASSIFIED",
                    categories: result?.categories ?? [],
                  })
                }
              />
              {result?.state === "FAILED" && !result.userEdited ? (
                <Action
                  label="분류 다시 시도"
                  disabled={!!working}
                  onPress={() =>
                    void run(article.id, async () => {
                      await classificationApi.retry(token, article.id);
                      setRefresh((v) => v + 1);
                    })
                  }
                />
              ) : null}
            </View>
            {editor?.article.id === article.id ? (
              <View style={styles.editor}>
                <Text accessibilityRole="header" style={styles.heading}>
                  분류 수정
                </Text>
                <Text style={styles.meta}>
                  직접 수정한 분류는 자동으로 바뀌지 않아요.
                </Text>
                <View style={styles.row}>
                  {(["ARTICLE", "OPEN_SOURCE", "UNCLASSIFIED"] as const).map(
                    (value) => (
                      <Action
                        key={value}
                        label={labels[value]}
                        selected={editor.kind === value}
                        disabled={!!working}
                        onPress={() =>
                          setEditor({ ...editor, kind: value, categories: [] })
                        }
                      />
                    ),
                  )}
                </View>
                <View style={styles.row}>
                  {(editor.kind === "UNCLASSIFIED"
                    ? []
                    : page.categories[editor.kind]
                  ).map((value) => (
                    <Action
                      role="checkbox"
                      key={value}
                      label={value}
                      selected={editor.categories.includes(value)}
                      disabled={!!working}
                      onPress={() =>
                        setEditor({
                          ...editor,
                          categories: editor.categories.includes(value)
                            ? editor.categories.filter((c) => c !== value)
                            : [...editor.categories, value],
                        })
                      }
                    />
                  ))}
                </View>
                <View style={styles.row}>
                  <Action
                    label="분류 저장"
                    disabled={
                      !!working ||
                      (editor.kind !== "UNCLASSIFIED" &&
                        !editor.categories.length)
                    }
                    onPress={() =>
                      void run(article.id, async () => {
                        await classificationApi.edit(token, article.id, {
                          kind: editor.kind,
                          categories: editor.categories,
                          revision:
                            editor.article.classification?.revision ?? 0,
                        });
                        setEditor(null);
                        setRefresh((v) => v + 1);
                      })
                    }
                  />
                  <Action
                    label="취소"
                    disabled={!!working}
                    onPress={() => setEditor(null)}
                  />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      {page?.nextCursor ? (
        <Action
          label={moreLoading ? "불러오는 중…" : "더 보기"}
          disabled={moreLoading}
          onPress={() => void loadMore()}
        />
      ) : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  title: { color: colors.ink, fontSize: 26, lineHeight: 36, fontWeight: "700" },
  description: { color: colors.muted, fontSize: 15, lineHeight: 24 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  categoryRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingBottom: spacing.md,
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceLow,
  },
  selected: { backgroundColor: colors.blueSoft },
  actionText: { color: colors.inkSoft, fontSize: 14, lineHeight: 22 },
  selectedText: { color: colors.primaryPressed, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  article: {
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    gap: spacing.sm,
  },
  read: { minHeight: 44, gap: spacing.sm },
  heading: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "700",
  },
  body: { color: colors.inkSoft, fontSize: 16, lineHeight: 26 },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  empty: { paddingVertical: spacing.xl, gap: spacing.md },
  editor: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  notice: {
    padding: spacing.md,
    backgroundColor: colors.surfaceLow,
    gap: spacing.sm,
  },
});
