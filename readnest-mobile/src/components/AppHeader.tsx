import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';

type Props = {
  title?: string;
  subtitle?: string;
};

export function AppHeader({ title = 'Unwind', subtitle }: Props) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={require('../../assets/unwind-icon.png')} style={styles.logo} />
        <Text style={styles.brand}>{title}</Text>
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.paper,
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  brand: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.8
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  subtitle: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  }
});
