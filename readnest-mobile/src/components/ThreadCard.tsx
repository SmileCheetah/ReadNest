import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBadge } from './StatusBadge';
import { colors, radius, spacing } from '../theme/tokens';
import type { SavedThread } from '../data/mockThreads';

type Props = {
  thread: SavedThread;
  onPress: (thread: SavedThread) => void;
  compact?: boolean;
};

export function ThreadCard({ thread, onPress, compact = false }: Props) {
  return (
    <Pressable
      onPress={() => onPress(thread)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={compact ? 1 : 2}>
            {thread.title}
          </Text>
          <View style={styles.sourcePill}>
            <Text style={styles.sourceText}>Threads</Text>
          </View>
        </View>
        {!compact ? (
          <Text style={styles.summary} numberOfLines={2}>
            {thread.summary}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.time}>{thread.savedAt}</Text>
          <StatusBadge status={thread.processStatus} />
          <StatusBadge status={thread.readStatus} />
        </View>
        <View style={styles.tagRow}>
          {thread.tags.slice(0, 3).map((tag) => (
            <Text key={tag} style={styles.tag}>
              #{tag}
            </Text>
          ))}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  },
  content: {
    flex: 1,
    gap: spacing.sm
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm
  },
  title: {
    flex: 1,
    color: colors.ink,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    letterSpacing: -0.2
  },
  sourcePill: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  sourceText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700'
  },
  summary: {
    color: colors.inkSoft,
    fontSize: 14,
    lineHeight: 21
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  time: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: '600'
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  tag: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600'
  }
});
