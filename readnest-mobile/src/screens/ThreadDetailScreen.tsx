import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, BackHandler, findNodeHandle, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import type { SavedThread } from "../data/mockThreads";
import { colors, radius, spacing } from "../theme/tokens";
import { isSupportedMarkdown, MarkdownSummary } from "../components/summary/MarkdownSummary";

type Props = {
  thread: SavedThread;
  onBack: () => void;
  onToggleReadStatus: (thread: SavedThread) => void;
  onMarkReadLater: (thread: SavedThread) => void;
  onRetrySummary: (thread: SavedThread) => void;
  onShareSummary: (thread: SavedThread) => void;
  onDelete: (thread: SavedThread) => void;
};

function clean(value: string) {
  return value.replace(/\*{1,3}/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function CollapsibleSection({ title, children }: { title: string; children: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.collapsible}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${title} ${expanded ? "접기" : "펼치기"}`} hitSlop={8} style={styles.collapseTrigger} onPress={() => setExpanded((value) => !value)}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={colors.inkSoft} />
      </Pressable>
      {expanded ? <Text style={styles.body}>{clean(children)}</Text> : null}
    </View>
  );
}

export function ThreadDetailScreen({ thread, onBack, onToggleReadStatus, onMarkReadLater, onRetrySummary, onShareSummary, onDelete }: Props) {
  const [showSource, setShowSource] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<View>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meta = thread.summaryMeta;
  const originalUrl = thread.originalUrl?.trim();
  const points = thread.keyPoints.filter((point) => point.trim()).slice(0, 3);
  const oneLine = meta?.oneLineSummary?.trim() || "요약 정보가 아직 없습니다.";
  const core = meta?.coreSummary?.trim();
  const remainingPoints = thread.keyPoints.filter((point) => point.trim()).slice(3);
  const canRetry = thread.processStatus === "SUMMARY_FAILED" || thread.processStatus === "CONTEXT_INSUFFICIENT";
  const hasV2Markdown = meta?.schemaVersion === 2 && isSupportedMarkdown(meta.summaryMarkdown);
  const v2Markdown = hasV2Markdown ? meta?.summaryMarkdown : null;
  const copy = async () => {
    if (copyState === "copying") return;
    setCopyState("copying");
    try {
      const copyText = hasV2Markdown
        ? [meta.summaryMarkdown, originalUrl ? `원문: ${originalUrl}` : null].filter(Boolean).join("\n\n")
        : [oneLine, ...thread.keyPoints.filter((point) => point.trim()), core, originalUrl ? `원문: ${originalUrl}` : null].filter(Boolean).join("\n\n");
      await Clipboard.setStringAsync(copyText);
      setCopyState("copied");
      copyTimer.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
      Alert.alert("복사 실패", "요약을 복사하지 못했습니다. 다시 시도해 주세요.");
    }
  };
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const focusTimer = setTimeout(() => {
      const nodeHandle = findNodeHandle(menuRef.current);
      if (nodeHandle !== null) AccessibilityInfo.setAccessibilityFocus(nodeHandle);
    }, 100);
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { setMenuOpen(false); return true; });
    return () => { clearTimeout(focusTimer); subscription.remove(); };
  }, [menuOpen]);
  const openOriginal = async () => {
    if (!originalUrl) return;
    try { await Linking.openURL(originalUrl); } catch { Alert.alert("원문을 열 수 없습니다", "잠시 후 다시 시도해 주세요."); }
  };
  const more = () => setMenuOpen(true);
  const choose = (action: () => void) => { setMenuOpen(false); action(); };
  return <View style={styles.root}>
    <View style={styles.appbar}>
      <Pressable accessibilityRole="button" accessibilityLabel="뒤로가기" style={styles.iconButton} onPress={onBack}><Ionicons name="arrow-back" size={22} color={colors.inkSoft} /></Pressable>
      <Text style={styles.brand}>Unwind</Text><View style={styles.spacer} />
      <Pressable accessibilityRole="button" accessibilityLabel="더보기" style={styles.iconButton} onPress={more}><Ionicons name="ellipsis-horizontal" size={23} color={colors.inkSoft} /></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.metaLine}>Threads · {thread.savedDateLabel} 저장</Text>
      <Text numberOfLines={3} style={styles.title}>{meta?.title?.trim() || thread.title || "제목 없음"}</Text>
      <View style={styles.card}>
        <View style={styles.summaryHeader}><Ionicons name="sparkles-outline" size={20} color={colors.primary} /><Text style={styles.summaryHeaderText}>AI 요약</Text><View style={styles.spacer} /><Pressable accessibilityRole="button" accessibilityLabel={copyState === "copied" ? "복사됨" : "요약 복사"} style={styles.copyButton} onPress={() => void copy()}><Text style={styles.copyText}>{copyState === "copied" ? "✓ 복사됨" : copyState === "copying" ? "복사 중" : copyState === "failed" ? "다시 복사" : "복사"}</Text></Pressable></View>
        {thread.processStatus === "SUMMARIZING" ? <Text style={styles.loadingSummary}>요약을 생성하는 중입니다…</Text> : thread.processStatus === "SUMMARY_FAILED" ? <Text style={styles.loadingSummary}>요약을 생성하지 못했습니다. 더보기에서 다시 시도해 주세요.</Text> : v2Markdown ? <MarkdownSummary markdown={v2Markdown} /> : <><Text style={styles.sectionTitle}>핵심 한 줄 요약</Text><Text style={styles.heroText}>{oneLine}</Text>{points.length ? <View style={styles.points}>{points.map((point, index) => <View key={`${point}-${index}`} style={styles.point}><Text style={styles.number}>{index + 1}</Text><Text style={styles.body}>{clean(point)}</Text></View>)}</View> : null}</>}
        {originalUrl ? <Pressable accessibilityRole="button" accessibilityLabel="원문 보기" style={styles.primaryCta} onPress={() => void openOriginal()}><Text style={styles.primaryCtaText}>원문 보기</Text><Ionicons name="open-outline" size={18} color={colors.surface} /></Pressable> : <Text style={styles.disabledCta}>원문 링크가 없습니다.</Text>}
      </View>
      {thread.processStatus === "SUMMARIZING" ? <Text style={styles.notice}>요약을 생성하는 중입니다.</Text> : null}
      {thread.processStatus === "SUMMARY_FAILED" ? <Text style={styles.notice}>요약을 생성하지 못했습니다. 더보기에서 다시 시도할 수 있습니다.</Text> : null}
      {thread.processStatus === "CONTEXT_INSUFFICIENT" ? <Text style={styles.notice}>일부 원문이 누락되었을 수 있습니다.</Text> : null}
      {!hasV2Markdown && (core || remainingPoints.length) ? <CollapsibleSection title="자세한 요약" children={[core, ...remainingPoints].filter(Boolean).join("\n\n")} /> : null}
      {thread.tags.length ? <View style={styles.tags}>{thread.tags.slice(0, 3).map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}</View> : null}
      {meta ? <CollapsibleSection title="분석 정보" children={[`맥락 상태: ${meta.contextStatus}`, meta.caution].filter(Boolean).join("\n\n")} /> : null}
      {showSource ? <View style={styles.source}><Text style={styles.sectionTitle}>요약에 사용된 원문</Text><Text selectable style={styles.body}>{thread.rawText || "저장된 원문이 없습니다."}</Text></View> : null}
      <Modal visible={menuOpen} transparent animationType="fade" accessibilityViewIsModal onRequestClose={() => setMenuOpen(false)}><Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}><View ref={menuRef} accessible accessibilityLabel="더보기 메뉴" style={styles.menu}><Text style={styles.menuTitle}>더보기</Text><Pressable style={styles.menuItem} onPress={() => choose(() => onToggleReadStatus(thread))}><Text style={styles.menuText}>{thread.readStatus === "READ" ? "안 읽음 표시" : "읽음 표시"}</Text></Pressable><Pressable style={styles.menuItem} onPress={() => choose(() => onMarkReadLater(thread))}><Text style={styles.menuText}>나중에 보기</Text></Pressable><Pressable style={styles.menuItem} onPress={() => choose(() => setShowSource((value) => !value))}><Text style={styles.menuText}>{showSource ? "원문 소스 닫기" : "원문 소스 보기"}</Text></Pressable><Pressable style={styles.menuItem} onPress={() => choose(() => onShareSummary(thread))}><Text style={styles.menuText}>공유</Text></Pressable>{canRetry ? <Pressable style={styles.menuItem} onPress={() => choose(() => onRetrySummary(thread))}><Text style={styles.menuText}>요약 재시도</Text></Pressable> : null}<Pressable style={styles.menuDelete} onPress={() => choose(() => onDelete(thread))}><Text style={styles.deleteText}>삭제</Text></Pressable></View></Pressable></Modal>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas }, appbar: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.hairline }, iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, brand: { color: colors.primary, fontSize: 22, fontWeight: "800" }, spacer: { flex: 1 }, content: { padding: spacing.lg, paddingBottom: spacing.xl }, metaLine: { color: colors.muted, fontSize: 13, marginBottom: spacing.sm }, title: { color: colors.ink, fontSize: 29, lineHeight: 37, fontWeight: "700", letterSpacing: -0.6, marginBottom: spacing.lg }, card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.hairline }, summaryHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }, summaryHeaderText: { color: colors.primary, fontSize: 18, fontWeight: "800", marginLeft: spacing.sm }, copyButton: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }, copyText: { color: colors.primary, fontWeight: "800" }, sectionTitle: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: "800", marginBottom: spacing.xs }, heroText: { color: colors.ink, fontSize: 17, lineHeight: 26, marginBottom: spacing.md }, points: { marginBottom: spacing.md }, point: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.sm }, number: { color: colors.primary, fontSize: 15, fontWeight: "800", width: 26, lineHeight: 24 }, body: { flex: 1, color: colors.ink, fontSize: 15, lineHeight: 24 }, primaryCta: { minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.primary, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }, primaryCtaText: { color: colors.surface, fontSize: 15, fontWeight: "800" }, disabledCta: { color: colors.muted, textAlign: "center", marginTop: spacing.md }, notice: { color: colors.inkSoft, backgroundColor: colors.surfaceMid, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.md, lineHeight: 21 }, loadingSummary: { color: colors.muted, fontSize: 16, lineHeight: 25, paddingVertical: spacing.md }, collapsible: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.hairline }, collapseTrigger: { minHeight: 44, flexDirection: "row", alignItems: "center" }, tags: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.lg }, tag: { color: colors.muted, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 }, source: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.md }, menuBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" }, menu: { backgroundColor: colors.surface, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }, menuTitle: { color: colors.ink, fontSize: 18, fontWeight: "800", marginBottom: spacing.sm }, menuItem: { minHeight: 48, justifyContent: "center" }, menuText: { color: colors.ink, fontSize: 16 }, menuDelete: { minHeight: 48, justifyContent: "center", borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: spacing.sm }, deleteText: { color: colors.red, fontSize: 16, fontWeight: "800" },
});
