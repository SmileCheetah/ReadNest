import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  findNodeHandle,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import type { SavedThread } from "../data/mockThreads";
import { colors, radius, spacing } from "../theme/tokens";
import {
  isSupportedMarkdown,
  MarkdownSummary,
} from "../components/summary/MarkdownSummary";
import {
  getSummaryErrorMessage,
  getSummaryPresentation,
} from "../components/summary/summaryPresentation";

type Props = {
  thread: SavedThread;
  onBack: () => void;
  onMarkReadOnOpen: (thread: SavedThread) => void | Promise<void>;
  onToggleReadStatus: (thread: SavedThread) => void;
  onMarkReadLater: (thread: SavedThread) => void;
  onRetrySummary: (thread: SavedThread) => void | Promise<void>;
  onShareSummary: (thread: SavedThread) => void;
  onDelete: (thread: SavedThread) => void;
  loadingDetail?: boolean;
  detailError?: string | null;
  onRefresh?: () => void;
};

function focusElement(view: View | null) {
  if (!view) return;
  if (Platform.OS === "web") {
    (view as View & { focus?: () => void }).focus?.();
    return;
  }
  const handle = findNodeHandle(view);
  if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
}

export function ThreadDetailScreen({
  thread,
  onBack,
  onMarkReadOnOpen,
  onToggleReadStatus,
  onMarkReadLater,
  onRetrySummary,
  onShareSummary,
  onDelete,
  loadingDetail = false,
  detailError,
  onRefresh,
}: Props) {
  const insets = useSafeAreaInsets();
  const [showSource, setShowSource] = useState(false);
  const [sourceInfoOpen, setSourceInfoOpen] = useState(false);
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [retryWait, setRetryWait] = useState(
    Math.max(0, thread.retryAfterSeconds ?? 0),
  );
  const menuTriggerRef = useRef<View>(null);
  const menuFirstItemRef = useRef<View>(null);
  const previousMenuOpen = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copySequence = useRef(0);
  const copyBusy = useRef(false);
  const retryBusy = useRef(false);
  const readEntry = useRef<{ id: string; consumed: boolean }>({
    id: thread.id,
    consumed: false,
  });
  const meta = thread.summaryMeta;
  const originalUrl = thread.originalUrl?.trim();
  const summaryMarkdown = isSupportedMarkdown(meta?.summaryMarkdown)
    ? meta.summaryMarkdown
    : null;
  const presentation = getSummaryPresentation(
    thread.processStatus,
    !!summaryMarkdown,
  );
  const processing =
    thread.processStatus === "SAVED" || thread.processStatus === "SUMMARIZING";
  const failed = thread.processStatus === "SUMMARY_FAILED";
  const retryDisabled =
    retryPending ||
    processing ||
    loadingDetail ||
    !!detailError ||
    retryWait > 0;
  const partial =
    thread.sourceCompleteness === "PARTIAL" ||
    thread.processStatus === "CONTEXT_INSUFFICIENT";
  const knownSource =
    thread.sourceCompleteness === "PARTIAL" ||
    thread.sourceCompleteness === "COMPLETE";
  const title = meta?.title?.trim() || thread.title || "저장한 글";

  useEffect(() => {
    if (readEntry.current.id !== thread.id)
      readEntry.current = { id: thread.id, consumed: false };
    if (!summaryMarkdown || readEntry.current.consumed) return;
    readEntry.current.consumed = true;
    if (thread.readStatus === "UNREAD") void onMarkReadOnOpen(thread);
  }, [onMarkReadOnOpen, summaryMarkdown, thread.id, thread.readStatus]);

  useEffect(() => {
    copySequence.current += 1;
    copyBusy.current = false;
    setCopyState("idle");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    return () => {
      copySequence.current += 1;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [thread.id, summaryMarkdown]);

  useEffect(() => {
    if (!menuOpen && !previousMenuOpen.current) return;
    previousMenuOpen.current = menuOpen;
    const timer = setTimeout(
      () =>
        focusElement(
          menuOpen ? menuFirstItemRef.current : menuTriggerRef.current,
        ),
      100,
    );
    return () => clearTimeout(timer);
  }, [menuOpen]);

  useEffect(() => {
    const seconds = Math.max(0, thread.retryAfterSeconds ?? 0);
    setRetryWait(seconds);
    if (!seconds) return;
    const until = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRetryWait(left);
      if (!left) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [thread.id, thread.generation, thread.retryAfterSeconds]);

  const retrySummary = async () => {
    if (retryDisabled || retryBusy.current) return;
    retryBusy.current = true;
    setRetryPending(true);
    try {
      await onRetrySummary(thread);
    } catch {
      Alert.alert(
        "요약을 요청하지 못했어요",
        "연결 상태를 확인한 뒤 다시 시도해 주세요.",
      );
    } finally {
      retryBusy.current = false;
      setRetryPending(false);
    }
  };
  const copy = async () => {
    if (copyBusy.current || !summaryMarkdown) return;
    copyBusy.current = true;
    const request = ++copySequence.current;
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopyState("copying");
    try {
      await Clipboard.setStringAsync(
        [summaryMarkdown, originalUrl ? `원문: ${originalUrl}` : null]
          .filter(Boolean)
          .join("\n\n"),
      );
      if (request !== copySequence.current) return;
      setCopyState("copied");
      AccessibilityInfo.announceForAccessibility(
        "요약과 원문 링크를 복사했습니다.",
      );
      copyTimer.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      if (request !== copySequence.current) return;
      setCopyState("failed");
      AccessibilityInfo.announceForAccessibility(
        "복사하지 못했습니다. 다시 복사를 눌러 주세요.",
      );
      Alert.alert(
        "복사하지 못했어요",
        "‘다시 복사’를 눌러 한 번 더 시도해 주세요.",
      );
    } finally {
      if (request === copySequence.current) copyBusy.current = false;
    }
  };
  const openOriginal = async () => {
    if (!originalUrl) return;
    if (!/^https?:\/\//i.test(originalUrl)) {
      Alert.alert("원문을 열 수 없어요", "올바른 웹 주소가 아닙니다.");
      return;
    }
    try {
      await Linking.openURL(originalUrl);
    } catch {
      Alert.alert(
        "원문을 열 수 없어요",
        "연결 상태를 확인한 뒤 다시 시도해 주세요.",
      );
    }
  };
  const choose = (action: () => void) => {
    setMenuOpen(false);
    action();
  };
  const markManually = (action: (item: SavedThread) => void) => {
    readEntry.current = { id: thread.id, consumed: true };
    action(thread);
  };
  const actions = (
    <View style={styles.actions}>
      {originalUrl ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="원문 보기"
          style={styles.primaryCta}
          onPress={() => void openOriginal()}
        >
          <Text style={styles.primaryCtaText}>원문 보기</Text>
          <Ionicons name="open-outline" size={18} color={colors.surface} />
        </Pressable>
      ) : (
        <Text style={styles.metaLine}>원문 링크가 없습니다.</Text>
      )}
      {summaryMarkdown ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copyState === "copied" ? "복사됨" : "요약 복사"}
          accessibilityState={{ disabled: copyState === "copying" }}
          disabled={copyState === "copying"}
          style={styles.copyButton}
          onPress={() => void copy()}
        >
          <Text style={styles.copyText}>
            {copyState === "copied"
              ? "✓ 복사됨"
              : copyState === "copying"
                ? "복사 중"
                : copyState === "failed"
                  ? "다시 복사"
                  : "복사"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
  const retryAction = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="요약 다시 생성"
      accessibilityState={{ disabled: retryDisabled }}
      disabled={retryDisabled}
      style={[styles.retryCta, retryDisabled && styles.disabled]}
      onPress={() => void retrySummary()}
    >
      <Text style={styles.retryText}>
        {retryPending
          ? "요청 중…"
          : retryWait > 0
            ? `${retryWait >= 60 ? `${Math.ceil(retryWait / 60)}분` : `${retryWait}초`} 후 다시 생성`
            : "요약 다시 생성"}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <View
        style={styles.screen}
        accessibilityElementsHidden={menuOpen}
        importantForAccessibility={menuOpen ? "no-hide-descendants" : "auto"}
      >
        <View style={styles.appbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="뒤로가기"
            style={styles.iconButton}
            onPress={onBack}
          >
            <Ionicons name="arrow-back" size={22} color={colors.ink} />
          </Pressable>
          <Text style={styles.brand}>Unwind</Text>
          <View style={styles.spacer} />
          <Pressable
            ref={menuTriggerRef}
            accessibilityRole="button"
            accessibilityLabel="더보기"
            accessibilityState={{ expanded: menuOpen }}
            style={styles.iconButton}
            onPress={() => setMenuOpen(true)}
          >
            <Ionicons name="ellipsis-horizontal" size={23} color={colors.ink} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.metaLine}>
            Threads · {thread.savedDateLabel} 저장
          </Text>
          {detailError ? (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text style={styles.noticeText}>
                최신 정보를 불러오지 못했어요. 마지막으로 확인한 내용을
                표시합니다.
              </Text>
              {onRefresh ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.textAction}
                  onPress={onRefresh}
                >
                  <Text style={styles.copyText}>다시 불러오기</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {summaryMarkdown && (processing || failed || thread.documentStale) ? (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text style={styles.noticeTitle}>
                {failed
                  ? "요약을 갱신하지 못했어요"
                  : processing
                    ? "새 요약을 만들고 있어요"
                    : "새 요약을 불러오는 중이에요"}
              </Text>
              <Text style={styles.noticeText}>
                마지막으로 확인한 요약을 표시하고 있어요.
                {failed
                  ? ` ${getSummaryErrorMessage(thread.errorCode)}`
                  : " 새 요약을 받으면 바뀝니다."}
              </Text>
              {failed ? retryAction : null}
            </View>
          ) : null}
          {partial ? (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text style={styles.noticeTitle}>
                일부 원문으로 만든 요약이에요
              </Text>
              <Text style={styles.noticeText}>
                이어지는 글이 빠졌을 수 있어요. 전체 맥락은 원문에서 확인해
                주세요.
              </Text>
            </View>
          ) : null}
          {summaryMarkdown ? (
            <MarkdownSummary
              key={thread.id}
              markdown={summaryMarkdown}
              titleFallback={title}
              afterIntro={actions}
            />
          ) : (
            <View>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              <View style={styles.stateBlock} accessibilityLiveRegion="polite">
                {loadingDetail ? (
                  <>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.body}>
                      저장한 글을 불러오는 중이에요.
                    </Text>
                  </>
                ) : detailError ? (
                  <Text style={styles.body}>
                    요약을 불러오지 못했어요. 다시 불러오면 생성 상태를 확인할
                    수 있습니다.
                  </Text>
                ) : presentation === "summarizing" ? (
                  <>
                    <ActivityIndicator color={colors.primary} />
                    <Text accessibilityRole="header" style={styles.stateTitle}>
                      요약을 준비하고 있어요
                    </Text>
                    <Text style={styles.body}>
                      원문을 확인하고 읽기 좋은 요약을 만들고 있어요. 완성되면
                      자동으로 표시됩니다.
                    </Text>
                  </>
                ) : (
                  <>
                    <Text accessibilityRole="header" style={styles.stateTitle}>
                      {presentation === "failed"
                        ? "요약을 만들지 못했어요"
                        : "아직 요약이 없어요"}
                    </Text>
                    <Text style={styles.body}>
                      {presentation === "failed"
                        ? getSummaryErrorMessage(thread.errorCode)
                        : "저장한 글을 요약하면 핵심을 빠르게 다시 확인할 수 있어요."}
                    </Text>
                    {retryAction}
                  </>
                )}
              </View>
              {actions}
            </View>
          )}
          {summaryMarkdown && thread.tags.length ? (
            <View style={styles.tags}>
              {thread.tags.slice(0, 3).map((tag) => (
                <Text key={tag} style={styles.tag}>
                  #{tag}
                </Text>
              ))}
            </View>
          ) : null}
          {knownSource ? (
            <View style={styles.sourceInfo}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: sourceInfoOpen }}
                accessibilityLabel="원문 수집 정보"
                style={styles.collapseTrigger}
                onPress={() => setSourceInfoOpen((value) => !value)}
              >
                <Text style={styles.metaLine}>원문 수집 정보</Text>
                <Ionicons
                  name={sourceInfoOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.muted}
                />
              </Pressable>
              {sourceInfoOpen ? (
                <Text style={styles.noticeText}>
                  {partial
                    ? "이어지는 원문 일부가 수집되지 않았습니다."
                    : "확인된 원문이 모두 수집되었습니다."}
                </Text>
              ) : null}
            </View>
          ) : null}
          {showSource ? (
            <View style={styles.sourceInfo}>
              <Text accessibilityRole="header" style={styles.stateTitle}>
                요약에 사용된 원문
              </Text>
              <Text selectable style={styles.body}>
                {thread.rawText || "저장된 원문이 없습니다."}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
      <Modal
        visible={menuOpen}
        transparent
        animationType="none"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={styles.menuBackdrop}>
          <Pressable
            accessible={false}
            importantForAccessibility="no"
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.menu,
              { paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            <View style={styles.menuHeader}>
              <Text accessibilityRole="header" style={styles.stateTitle}>
                글 관리
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="더보기 닫기"
                style={styles.iconButton}
                onPress={() => setMenuOpen(false)}
              >
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView>
              <Pressable
                ref={menuFirstItemRef}
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => choose(() => markManually(onToggleReadStatus))}
              >
                <Text style={styles.menuText}>
                  {thread.readStatus === "READ" ? "안 읽음 표시" : "읽음 표시"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => choose(() => markManually(onMarkReadLater))}
              >
                <Text style={styles.menuText}>나중에 보기</Text>
              </Pressable>
              {summaryMarkdown ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.menuItem}
                  onPress={() => choose(() => onShareSummary(thread))}
                >
                  <Text style={styles.menuText}>요약 공유</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => choose(() => setShowSource((value) => !value))}
              >
                <Text style={styles.menuText}>
                  {showSource ? "원문 소스 닫기" : "원문 소스 보기"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="요약 다시 생성"
                accessibilityState={{ disabled: retryDisabled }}
                disabled={retryDisabled}
                style={[styles.menuItem, retryDisabled && styles.disabled]}
                onPress={() => choose(() => void retrySummary())}
              >
                <Text style={styles.menuText}>
                  {processing
                    ? "새 요약 생성 중"
                    : retryPending
                      ? "요약 요청 중…"
                      : retryWait > 0
                        ? "잠시 후 다시 생성"
                        : "요약 다시 생성"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.menuDelete}
                onPress={() => choose(() => onDelete(thread))}
              >
                <Text style={styles.deleteText}>삭제</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  screen: { flex: 1 },
  appbar: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: "700",
    flexShrink: 1,
  },
  spacer: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  metaLine: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.ink,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: spacing.md,
    flexShrink: 1,
  },
  body: { color: colors.inkSoft, fontSize: 16, lineHeight: 27, flexShrink: 1 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  primaryCta: {
    minHeight: 48,
    flexGrow: 1,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryCtaText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "700",
    flexShrink: 1,
  },
  copyButton: {
    minWidth: 64,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  copyText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  stateBlock: {
    backgroundColor: colors.surfaceLow,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  stateTitle: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "700",
    flexShrink: 1,
  },
  notice: {
    backgroundColor: colors.surfaceLow,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  noticeTitle: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
  },
  noticeText: { color: colors.inkSoft, fontSize: 14, lineHeight: 23 },
  retryCta: {
    minHeight: 48,
    paddingVertical: spacing.sm,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  retryText: {
    color: colors.primary,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
  },
  textAction: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  disabled: { opacity: 0.6 },
  sourceInfo: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  tag: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  collapseTrigger: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  menu: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "85%",
  },
  menuHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  menuItem: {
    minHeight: 48,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  menuText: { color: colors.ink, fontSize: 16, lineHeight: 26 },
  menuDelete: {
    minHeight: 48,
    paddingVertical: spacing.sm,
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    marginTop: spacing.sm,
  },
  deleteText: {
    color: colors.red,
    fontSize: 16,
    lineHeight: 26,
    fontWeight: "700",
  },
});
