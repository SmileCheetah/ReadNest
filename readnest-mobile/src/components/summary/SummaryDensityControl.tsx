import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { SummaryDensity } from "../../data/mockThreads";
import { colors, radius, spacing } from "../../theme/tokens";

type Props = {
  selected: SummaryDensity;
  busy: boolean;
  failed: boolean;
  partialSource: boolean;
  retryWait: number;
  retryDisabled: boolean;
  onSelect: (density: SummaryDensity) => void;
  onRetry: () => void;
};

const options: ReadonlyArray<readonly [SummaryDensity, string]> = [
  ["CONCISE", "핵심만"],
  ["STANDARD", "기본"],
  ["DETAILED", "자세히"],
];

const selectedLabel = (density: SummaryDensity) =>
  density === "CONCISE" ? "핵심만" : "자세히";

export function SummaryDensityControl({
  selected,
  busy,
  failed,
  partialSource,
  retryWait,
  retryDisabled,
  onSelect,
  onRetry,
}: Props) {
  return (
    <>
      <View
        accessibilityRole="tablist"
        accessibilityLabel="요약 자세히 보기"
        style={styles.selector}
      >
        {options.map(([density, label]) => {
          const isSelected = selected === density;
          return (
            <Pressable
              key={density}
              accessibilityRole="tab"
              accessibilityLabel={`${label} 요약`}
              accessibilityState={{ selected: isSelected }}
              aria-selected={isSelected}
              style={[styles.option, isSelected && styles.optionSelected]}
              onPress={() => onSelect(density)}
            >
              <Text
                style={[styles.label, isSelected && styles.labelSelected]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {busy ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.statusText}>
            {`${selectedLabel(selected)} 요약을 만들고 있어요. 완성될 때까지 기본 요약을 표시합니다.`}
          </Text>
        </View>
      ) : failed ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>
              이 밀도의 요약을 만들지 못했어요
            </Text>
            <Text style={styles.statusText}>기본 요약은 그대로 볼 수 있어요.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${selectedLabel(selected)} 요약 다시 시도`}
            accessibilityState={{ disabled: retryDisabled }}
            disabled={retryDisabled}
            style={[styles.retry, retryDisabled && styles.disabled]}
            onPress={onRetry}
          >
            <Text style={styles.retryText}>
              {retryWait > 0
                ? `${retryWait >= 60 ? `${Math.ceil(retryWait / 60)}분` : `${retryWait}초`} 후 재시도`
                : retryDisabled
                  ? "새 기본 요약 후 다시 시도"
                  : "다시 시도"}
            </Text>
          </Pressable>
        </View>
      ) : partialSource && selected === "DETAILED" ? (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          수집된 원문 범위 안에서만 자세히 보여줘요. 빠진 원문은 복원할 수
          없습니다.
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  selector: {
    flexDirection: "row",
    backgroundColor: colors.surfaceLow,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    padding: 2,
    marginBottom: spacing.lg,
  },
  option: {
    minWidth: 0,
    minHeight: 44,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  optionSelected: { backgroundColor: colors.surface },
  label: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
  labelSelected: { color: colors.primary, fontWeight: "700" },
  status: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingBottom: spacing.md,
    marginBottom: spacing.lg,
  },
  statusCopy: { flex: 1, minWidth: 0 },
  statusTitle: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
  },
  statusText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    flex: 1,
    flexShrink: 1,
  },
  retry: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
  },
  retryText: {
    color: colors.primary,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 21,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingBottom: spacing.md,
    marginBottom: spacing.lg,
  },
  disabled: { opacity: 0.6 },
});
