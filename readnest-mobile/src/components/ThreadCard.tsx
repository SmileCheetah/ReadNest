import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBadge } from "./StatusBadge";
import { colors, radius, spacing } from "../theme/tokens";
import type { SavedThread } from "../data/mockThreads";

type Props = {
  thread: SavedThread;
  onPress: (thread: SavedThread) => void;
  compact?: boolean;
};

export function ThreadCard({ thread, onPress }: Props) {
  const { fontScale } = useWindowDimensions();
  const previewLines = fontScale >= 1.5 ? undefined : 2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${thread.title}. ${thread.summaryPreview || ""} ${thread.readStatus === "UNREAD" ? "안 읽음" : thread.readStatus === "READ_LATER" ? "다시 보기" : "읽음"}`}
      onPress={() => onPress(thread)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={previewLines}>
            {thread.title}
          </Text>
        </View>
        {thread.summaryPreview ? (
          <Text style={styles.summary} numberOfLines={previewLines}>
            {thread.summaryPreview}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.time}>
            Threads · {thread.savedDateLabel} 저장
          </Text>
          {thread.processStatus !== "SUMMARY_DONE" ? (
            <StatusBadge status={thread.processStatus} />
          ) : null}
          {thread.readStatus === "READ_LATER" ? (
            <StatusBadge status={thread.readStatus} />
          ) : thread.readStatus === "UNREAD" ? (
            <Text style={styles.unread}>안 읽음</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pressed: {
    opacity: 0.78,
  },
  content: {
    flex: 1,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.ink,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sourcePill: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  sourceText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  summary: {
    color: colors.inkSoft,
    fontSize: 15,
    lineHeight: 23,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  time: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "600",
  },
  unread: { color: colors.inkSoft, fontSize: 12, fontWeight: "600" },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tag: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
});
