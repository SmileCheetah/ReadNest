import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme/tokens';
import type { ScreenName } from '../../App';

type Props = {
  current: ScreenName;
  onChange: (screen: ScreenName) => void;
};

const items: Array<{ key: ScreenName; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'home', label: '홈', icon: 'home-outline' },
  { key: 'archive', label: '아카이브', icon: 'archive-outline' },
  { key: 'settings', label: '설정', icon: 'settings-outline' }
];

export function BottomNav({ current, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      {items.map((item) => {
        const active = current === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.item, active && styles.activeItem]}
          >
            <Ionicons name={item.icon} size={22} color={active ? colors.primary : colors.muted} />
            <Text style={[styles.label, active && styles.activeLabel]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 72,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.paper,
    borderTopColor: colors.hairline,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around'
  },
  item: {
    minWidth: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    gap: 3
  },
  activeItem: {
    backgroundColor: colors.blueSoft
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700'
  },
  activeLabel: {
    color: colors.primary
  }
});
