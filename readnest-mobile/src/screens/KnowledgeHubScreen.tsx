import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  autoConnectionsApi,
  type AutoConnection,
  type ConnectedArticle,
  type ConnectionsResponse,
} from "../api/autoConnectionsApi";
import { readnestApi } from "../api/readnestApi";
import { mapArticleToThread } from "../api/articleMapper";
import type { SavedThread } from "../data/mockThreads";
import { colors, spacing } from "../theme/tokens";
import { KnowledgeScreen } from "./KnowledgeScreen";

type Props = {
  token: string;
  active?: boolean;
  onBack: () => void;
  onOpenThread: (thread: SavedThread) => void;
};

const relationLabel = {
  SIMILAR: "같은 관점",
  COMPLEMENT: "이어 읽기",
  CONTRAST: "다른 관점",
};

export function KnowledgeHubScreen({
  token,
  active = true,
  onBack,
  onOpenThread,
}: Props) {
  const [manual, setManual] = useState(false);
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(true);
  const threadReveal = useRef(new Animated.Value(0)).current;

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await autoConnectionsApi.list(token, signal);
        if (signal?.aborted) return;
        setData(result);
        setError(null);
        setFocusedId((prior) => {
          if (prior && result.articles.some((article) => article.id === prior))
            return prior;
          const firstLinked = result.articles.find((article) =>
            result.connections.some(
              (link) =>
                link.leftArticleId === article.id ||
                link.rightArticleId === article.id,
            ),
          );
          return firstLinked?.id ?? result.articles[0]?.id ?? null;
        });
      } catch {
        if (!signal?.aborted)
          setError(
            "연결된 글을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!active || manual) return;
    const controller = new AbortController();
    void autoConnectionsApi
      .scan(token)
      .catch(() => undefined)
      .finally(() => void refresh(controller.signal));
    const timer = setInterval(() => {
      void autoConnectionsApi
        .scan(token)
        .catch(() => undefined)
        .finally(() => void refresh(controller.signal));
    }, 8000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active, manual, refresh, token]);

  useEffect(() => {
    threadReveal.stopAnimation();
    if (reduceMotion) {
      threadReveal.setValue(1);
      return;
    }
    threadReveal.setValue(0);
    Animated.timing(threadReveal, {
      toValue: 1,
      duration: 540,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [data?.connections.length, focusedId, reduceMotion, threadReveal]);

  const articlesById = useMemo(
    () => new Map(data?.articles.map((article) => [article.id, article]) ?? []),
    [data],
  );
  const focused = focusedId ? articlesById.get(focusedId) : undefined;
  const neighbors = useMemo(
    () =>
      data?.connections.flatMap((link) => {
        if (
          link.leftArticleId !== focusedId &&
          link.rightArticleId !== focusedId
        )
          return [];
        const otherId =
          link.leftArticleId === focusedId
            ? link.rightArticleId
            : link.leftArticleId;
        const other = articlesById.get(otherId);
        return other
          ? [
              {
                link,
                other,
                focusedEvidence:
                  link.leftArticleId === focusedId
                    ? link.leftEvidence
                    : link.rightEvidence,
                otherEvidence:
                  link.leftArticleId === focusedId
                    ? link.rightEvidence
                    : link.leftEvidence,
              },
            ]
          : [];
      }) ?? [],
    [articlesById, data, focusedId],
  );
  const pendingCount =
    data?.articles.filter(
      (item) =>
        item.scanState === "PENDING" ||
        item.scanState === "RUNNING" ||
        (!item.scanState &&
          (item.processStatus === "SUMMARY_DONE" ||
            item.processStatus === "CONTEXT_INSUFFICIENT")),
    ).length ?? 0;
  const failed =
    data?.articles.filter((item) => item.scanState === "FAILED") ?? [];

  const openArticle = async (id: string) => {
    if (openingId) return;
    setOpeningId(id);
    try {
      const article = await readnestApi.getArticle(token, id);
      onOpenThread(mapArticleToThread(article));
    } catch {
      setError("글을 열지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요.");
    } finally {
      setOpeningId(null);
    }
  };

  if (manual)
    return (
      <KnowledgeScreen
        token={token}
        active={active}
        onBack={() => setManual(false)}
        onOpenThread={onOpenThread}
      />
    );

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="보관함으로 돌아가기"
          onPress={onBack}
          style={styles.iconButton}
        >
          <Ionicons name="arrow-back" size={23} color={colors.ink} />
        </Pressable>
        <Text style={styles.topTitle}>내 지식 모음</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>저장한 글에서 자동으로 찾았어요</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          이어지는 생각
        </Text>
        <Text style={styles.intro}>
          주제를 직접 만들지 않아도, 수집된 원문 범위에서 이어지는 관점을
          찾아요. 연결 이유와 양쪽 글의 근거를 확인해 보세요.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setManual(true)}
          style={styles.manualLink}
        >
          <Text style={styles.manualText}>내가 만든 주제 보기</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.primary} />
        </Pressable>

        {loading && !data ? (
          <View style={styles.state}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>저장한 글을 살펴보는 중…</Text>
          </View>
        ) : error && !data ? (
          <View style={styles.state}>
            <Text style={styles.stateText}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => void refresh()}>
              <Text style={styles.retryText}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : data?.articles.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>아직 저장한 글이 없어요</Text>
            <Text style={styles.stateText}>
              Threads 링크를 저장하면 글 사이의 연결이 여기에 나타나요.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                글 사이의 연결
              </Text>
              <Text style={styles.count}>
                {data?.connections.length ?? 0}개
              </Text>
            </View>
            {pendingCount > 0 && (
              <View style={styles.statusLine}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.statusText}>
                  {pendingCount}개 글에서 연결을 찾고 있어요. 요약은 바로 읽을
                  수 있어요.
                </Text>
              </View>
            )}
            {focused && (
              <>
                <Text style={styles.smallLabel}>기준 글</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void openArticle(focused.id)}
                  style={styles.focusArticle}
                >
                  <Text style={styles.focusTitle}>
                    {focused.title || "제목을 가져오는 중"}
                  </Text>
                  <Text style={styles.focusHint}>원문과 요약 보기 ↗</Text>
                </Pressable>
              </>
            )}
            {neighbors.length ? (
              <View style={styles.threadTrack}>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.threadLine,
                    {
                      opacity: threadReveal,
                      transform: [{ scaleY: threadReveal }],
                    },
                  ]}
                />
                {neighbors.map(
                  ({ link, other, focusedEvidence, otherEvidence }) => (
                    <ConnectedRow
                      key={link.id}
                      link={link}
                      other={other}
                      focusedEvidence={focusedEvidence}
                      otherEvidence={otherEvidence}
                      onPress={() => void openArticle(other.id)}
                      onFocus={() => setFocusedId(other.id)}
                    />
                  ),
                )}
              </View>
            ) : (
              <View style={styles.emptyConnection}>
                <Text style={styles.stateTitle}>
                  {pendingCount
                    ? "연결을 찾고 있어요"
                    : "아직 확인된 연결이 없어요"}
                </Text>
                <Text style={styles.stateText}>
                  같은 주제처럼 보여도 근거가 부족하면 억지로 이어 붙이지
                  않아요. 다른 글을 저장하면 다시 살펴봅니다.
                </Text>
              </View>
            )}
            {data && data.articles.length > 1 && (
              <View style={styles.allArticles}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  다른 글 살펴보기
                </Text>
                {data.articles
                  .filter((article) => article.id !== focusedId)
                  .slice(0, 30)
                  .map((article) => (
                    <Pressable
                      key={article.id}
                      accessibilityRole="button"
                      onPress={() => setFocusedId(article.id)}
                      style={styles.articleOption}
                    >
                      <Text style={styles.articleOptionText} numberOfLines={2}>
                        {article.title || "제목을 가져오는 중"}
                      </Text>
                      <Ionicons
                        name="arrow-forward"
                        size={16}
                        color={colors.muted}
                      />
                    </Pressable>
                  ))}
              </View>
            )}
            {failed.length > 0 && (
              <View style={styles.failedBox}>
                <Text style={styles.stateText}>
                  {failed.length}개 글의 연결을 확인하지 못했어요. 요약은 그대로
                  남아 있어요.
                </Text>
                {failed.slice(0, 3).map((article) => (
                  <Pressable
                    key={article.id}
                    accessibilityRole="button"
                    style={styles.retry}
                    onPress={() =>
                      void autoConnectionsApi
                        .retry(token, article.id)
                        .then(() => refresh())
                        .catch(() =>
                          setError(
                            "다시 연결하지 못했어요. 잠시 후 재시도해 주세요.",
                          ),
                        )
                    }
                  >
                    <Text style={styles.retryText}>
                      {article.title || "저장한 글"} 다시 찾기
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {error && (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ConnectedRow({
  link,
  other,
  focusedEvidence,
  otherEvidence,
  onPress,
  onFocus,
}: {
  link: AutoConnection;
  other: ConnectedArticle;
  focusedEvidence: string;
  otherEvidence: string;
  onPress: () => void;
  onFocus: () => void;
}) {
  return (
    <View style={styles.row}>
      <View
        style={styles.node}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.rowBody}>
        <Text style={styles.relation}>{relationLabel[link.relationType]}</Text>
        <Text style={styles.reason}>{link.reason}</Text>
        <View style={styles.evidence}>
          <Text style={styles.evidenceLabel}>이 글에서</Text>
          <Text style={styles.evidenceText}>“{focusedEvidence}”</Text>
          <Text style={styles.evidenceLabel}>이어지는 글에서</Text>
          <Text style={styles.evidenceText}>“{otherEvidence}”</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={styles.relatedArticle}
        >
          <Text style={styles.relatedTitle}>
            {other.title || "제목을 가져오는 중"}
          </Text>
          <Text style={styles.openText}>글 읽기 ↗</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onFocus}
          style={styles.followLink}
        >
          <Text style={styles.followText}>이 글에서 계속 이어보기</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  topBar: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  iconButton: { width: 44, height: 44, justifyContent: "center" },
  topTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: 40,
    paddingBottom: 80,
  },
  eyebrow: {
    color: colors.primaryPressed,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  heading: {
    color: colors.ink,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "800",
  },
  intro: { color: colors.inkSoft, fontSize: 16, lineHeight: 26, marginTop: 12 },
  manualLink: {
    alignSelf: "flex-start",
    minHeight: 44,
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
  },
  manualText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  sectionHeader: {
    marginTop: 40,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
    paddingBottom: 12,
  },
  sectionTitle: {
    color: colors.ink,
    fontWeight: "700",
    fontSize: 20,
    lineHeight: 28,
  },
  count: { color: colors.muted, fontSize: 14 },
  statusLine: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    marginTop: 18,
  },
  statusText: { flex: 1, color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  smallLabel: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 30,
    marginBottom: 8,
  },
  focusArticle: {
    minHeight: 88,
    borderTopWidth: 2,
    borderColor: colors.primary,
    paddingTop: 14,
    paddingBottom: 10,
  },
  focusTitle: {
    color: colors.ink,
    fontSize: 23,
    lineHeight: 31,
    fontWeight: "700",
  },
  focusHint: { color: colors.primary, fontSize: 13, marginTop: 9 },
  threadTrack: { marginTop: 8, marginLeft: 10 },
  threadLine: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.primary,
  },
  row: { flexDirection: "row", alignItems: "flex-start" },
  node: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    marginLeft: -5,
    marginTop: 27,
    marginRight: 24,
  },
  rowBody: {
    flex: 1,
    paddingTop: 24,
    paddingBottom: 28,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  relation: { fontSize: 13, fontWeight: "700", color: colors.primaryPressed },
  reason: {
    color: colors.ink,
    fontSize: 17,
    lineHeight: 27,
    marginTop: 8,
    fontWeight: "600",
  },
  evidence: {
    marginTop: 16,
    paddingLeft: 14,
    borderLeftWidth: 2,
    borderColor: colors.hairline,
  },
  evidenceLabel: { color: colors.muted, fontSize: 12, marginTop: 8 },
  evidenceText: {
    color: colors.inkSoft,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 3,
  },
  relatedArticle: {
    minHeight: 54,
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    marginTop: 18,
  },
  relatedTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 23,
    flex: 1,
  },
  openText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  followLink: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  followText: { color: colors.primary, fontSize: 13 },
  allArticles: {
    marginTop: 36,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    paddingTop: 24,
  },
  articleOption: {
    minHeight: 52,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  articleOptionText: {
    flex: 1,
    color: colors.inkSoft,
    fontSize: 15,
    lineHeight: 23,
  },
  state: { marginTop: 56, alignItems: "center", gap: 12 },
  stateTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 26,
  },
  stateText: { color: colors.inkSoft, fontSize: 15, lineHeight: 24 },
  emptyConnection: { paddingVertical: 32 },
  failedBox: {
    marginTop: 30,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  retry: { minHeight: 44, justifyContent: "center" },
  retryText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  errorText: { color: colors.red, fontSize: 14, lineHeight: 21, marginTop: 16 },
});
