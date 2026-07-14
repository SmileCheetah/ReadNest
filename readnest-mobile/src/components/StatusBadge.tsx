import { Text, View, StyleSheet } from 'react-native';
import { colors, radius } from '../theme/tokens';
import type { ProcessStatus, ReadStatus } from '../data/mockThreads';

type Props = {
  status: ProcessStatus | ReadStatus;
  kind?: 'process' | 'read';
};

const statusMap: Record<string, { label: string; bg: string; fg: string; dot?: boolean }> = {
  SAVED: { label: '저장됨', bg: colors.surfaceLow, fg: colors.muted },
  SUMMARIZING: { label: '요약 중', bg: colors.blueSoft, fg: colors.primary, dot: true },
  SUMMARY_DONE: { label: '요약 완료', bg: colors.greenSoft, fg: colors.green },
  SUMMARY_FAILED: { label: '요약 실패', bg: colors.redSoft, fg: colors.red },
  CONTEXT_INSUFFICIENT: { label: '맥락 부족', bg: colors.amberSoft, fg: colors.amber },
  UNREAD: { label: '안 읽음', bg: colors.surfaceLow, fg: colors.muted },
  READ: { label: '읽음', bg: colors.greenSoft, fg: colors.green },
  READ_LATER: { label: '나중에 다시 보기', bg: colors.blueSoft, fg: colors.primary }
};

export function StatusBadge({ status }: Props) {
  const item = statusMap[status];

  return (
    <View style={[styles.badge, { backgroundColor: item.bg }]}>
      {item.dot ? <View style={[styles.dot, { backgroundColor: item.fg }]} /> : null}
      <Text style={[styles.text, { color: item.fg }]}>{item.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  text: {
    fontSize: 11,
    fontWeight: '700'
  }
});
