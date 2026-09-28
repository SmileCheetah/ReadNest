import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import {
  getCollapsedBlocks,
  isHeadingBlock,
  markdownToPlainText,
  parseMarkdown,
  splitDocumentOpening,
  type MarkdownBlock,
} from "./summaryMarkdown";

export { isSupportedMarkdown, parseMarkdown } from "./summaryMarkdown";

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <Text key={index} style={styles.bold}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function RenderBlock({
  block,
  opening = false,
}: {
  block: MarkdownBlock;
  opening?: boolean;
}) {
  if (block.type === "heading")
    return (
      <Text
        selectable
        accessibilityRole="header"
        style={
          block.level === 1
            ? styles.h1
            : block.level === 2
              ? styles.h2
              : styles.h3
        }
      >
        {inline(block.text ?? "")}
      </Text>
    );
  if (block.type === "quote")
    return (
      <View style={styles.quote}>
        <Text selectable style={styles.quoteText}>
          {inline(block.text ?? "")}
        </Text>
      </View>
    );
  if (block.type === "ul" || block.type === "ol")
    return (
      <View style={styles.list}>
        {block.items?.map((item, index) => {
          const marker =
            block.type === "ol"
              ? `${item.marker ?? ""}${item.delimiter ?? "."}`
              : "•";
          return (
            <View key={index} style={styles.listItem}>
              <Text
                accessible={false}
                importantForAccessibility="no"
                style={styles.marker}
              >
                {marker}
              </Text>
              <Text
                selectable
                accessibilityLabel={`${marker} ${markdownToPlainText(item.text)}`}
                style={[styles.body, styles.listBody]}
              >
                {inline(item.text)}
              </Text>
            </View>
          );
        })}
      </View>
    );
  const itemHeading = isHeadingBlock(block);
  return (
    <Text
      selectable
      accessibilityRole={itemHeading ? "header" : undefined}
      style={[
        styles.body,
        opening && styles.intro,
        itemHeading && styles.itemHeading,
      ]}
    >
      {inline(block.text ?? "")}
    </Text>
  );
}

export function MarkdownSummary({
  markdown,
  titleFallback,
  afterIntro,
  showTitle = true,
}: {
  markdown: string;
  titleFallback?: string;
  afterIntro?: ReactNode;
  showTitle?: boolean;
}) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  const collapsed = useMemo(() => getCollapsedBlocks(blocks), [blocks]);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [markdown]);
  const hasHiddenBlocks = collapsed.length < blocks.length;
  const visible = expanded ? blocks : collapsed;
  const opening = splitDocumentOpening(visible);
  return (
    <View>
      {showTitle
        ? opening.title
          ? <RenderBlock block={opening.title} />
          : titleFallback
            ? <Text selectable accessibilityRole="header" style={styles.h1}>
                {titleFallback}
              </Text>
            : null
        : null}
      {opening.intro ? <RenderBlock block={opening.intro} opening /> : null}
      {afterIntro}
      {opening.remainder.map((block, index) => (
        <RenderBlock key={index} block={block} />
      ))}
      {hasHiddenBlocks ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? "전체 요약 접기" : "전체 요약 펼치기"}
          style={styles.expandButton}
          onPress={() => setExpanded((value) => !value)}
        >
          <Text style={styles.expandText}>
            {expanded ? "요약 접기" : "전체 요약 펼치기"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  h1: {
    color: colors.ink,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: spacing.md,
    flexShrink: 1,
  },
  h2: {
    color: colors.ink,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "700",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    flexShrink: 1,
  },
  h3: {
    color: colors.ink,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "700",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    flexShrink: 1,
  },
  body: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 27,
    marginBottom: spacing.md,
    flexShrink: 1,
  },
  intro: { color: colors.inkSoft },
  itemHeading: {
    fontSize: 17,
    lineHeight: 27,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontWeight: "700",
  },
  bold: { fontWeight: "700" },
  list: { marginBottom: spacing.sm },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  marker: {
    color: colors.inkSoft,
    flexShrink: 0,
    fontSize: 16,
    lineHeight: 27,
    fontWeight: "600",
  },
  listBody: { flex: 1, minWidth: 0, marginBottom: 0 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.md,
    marginVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  quoteText: {
    color: colors.inkSoft,
    fontSize: 16,
    lineHeight: 27,
    flexShrink: 1,
  },
  expandButton: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  expandText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
});
