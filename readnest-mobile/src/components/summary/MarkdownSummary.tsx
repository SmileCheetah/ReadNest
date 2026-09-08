import { Fragment, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../../theme/tokens";

type ListItem = { marker?: string; text: string };
type Block = { type: "heading" | "paragraph" | "ul" | "ol" | "quote"; level?: number; text?: string; items?: ListItem[] };

export function isSupportedMarkdown(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const markdown = value.trim();
  if (!markdown || markdown.length > 16000) return false;
  if (/<\/?[a-z][^>]*>|```|\|.*\|/i.test(markdown)) return false;
  if (/^#{1}(?:\s|$)|^#{4,}(?:\s|$)/m.test(markdown)) return false;
  if (/\[[^\]]+\]\([^)]+\)/.test(markdown)) return false;
  const paragraphs = markdown.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (new Set(paragraphs).size !== paragraphs.length) return false;
  const boldCount = (markdown.match(/\*\*[^*]+\*\*/g) ?? []).length;
  return boldCount <= Math.max(1, paragraphs.length) * 2 && (markdown.match(/\*\*/g) ?? []).length === boldCount * 2;
}

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <Text key={index} style={styles.bold}>{part.slice(2, -2)}</Text>
    : <Fragment key={index}>{part.replace(/<[^>]*>/g, "")}</Fragment>);
}

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: ListItem[] } | null = null;
  let quote: string[] = [];
  const flush = () => { if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") }); paragraph = []; };
  const flushList = () => { if (list) blocks.push({ type: list.type, items: list.items }); list = null; };
  const flushQuote = () => { if (quote.length) blocks.push({ type: "quote", text: quote.join("\n") }); quote = []; };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); flushList(); flushQuote(); continue; }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) { flush(); flushList(); flushQuote(); blocks.push({ type: "heading", level: heading[1].length, text: heading[2] }); continue; }
    const numberedHeading = line.match(/^\d+\.\s+(\*\*[^*]+\*\*)$/);
    if (numberedHeading) { flush(); flushList(); flushQuote(); blocks.push({ type: "heading", level: 3, text: numberedHeading[1] }); continue; }
    const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
    const unordered = line.match(/^[-*•]\s+(.+)$/);
    if (ordered || unordered) { flush(); flushQuote(); const type = ordered ? "ol" : "ul"; if (!list || list.type !== type) { flushList(); list = { type, items: [] }; } list.items.push(ordered ? { marker: ordered[1], text: ordered[2] } : { text: unordered?.[1] ?? "" }); continue; }
    if (line.startsWith(">")) { flush(); flushList(); quote.push(line.replace(/^>\s?/, "")); continue; }
    flushList(); flushQuote(); paragraph.push(line);
  }
  flush(); flushList(); flushQuote();
  return blocks;
}

export function MarkdownSummary({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  const [expanded, setExpanded] = useState(false);
  const isLong = markdown.length > 4000;
  const visibleBlocks = isLong && !expanded ? blocks.reduce<Block[]>((result, block, index) => {
    const currentLength = result.reduce((sum, item) => sum + (item.text?.length ?? item.items?.map((entry) => entry.text).join("").length ?? 0), 0);
    const blockLength = block.text?.length ?? block.items?.map((entry) => entry.text).join("").length ?? 0;
    return index === 0 || currentLength + blockLength <= 4000 ? [...result, block] : result;
  }, []) : blocks;
  return <View>{visibleBlocks.map((block, index) => {
    if (block.type === "heading") return <Text key={index} accessibilityRole="header" style={block.level === 2 ? styles.h2 : styles.h3}>{inline(block.text ?? "")}</Text>;
    if (block.type === "quote") return <View key={index} style={styles.quote}><Text style={styles.quoteText}>{inline(block.text ?? "")}</Text></View>;
    if (block.type === "ul" || block.type === "ol") return <View key={index} accessible accessibilityLabel={block.type === "ol" ? "번호 목록" : "목록"} style={styles.list}>{block.items?.map((item, itemIndex) => <View key={itemIndex} accessible accessibilityLabel={block.type === "ol" ? `${item.marker ?? `${itemIndex + 1}`}. ${item.text}` : item.text} style={styles.listItem}><Text style={styles.marker}>{block.type === "ol" ? `${item.marker ?? `${itemIndex + 1}`}.` : "•"}</Text><Text style={styles.body}>{inline(item.text)}</Text></View>)}</View>;
    return <Text key={index} style={styles.body}>{inline(block.text ?? "")}</Text>;
  })}{isLong ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={expanded ? "전체 요약 접기" : "전체 요약 펼치기"} style={styles.expandButton} onPress={() => setExpanded((value) => !value)}><Text style={styles.expandText}>{expanded ? "요약 접기" : "전체 요약 펼치기"}</Text></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  h2: { color: colors.ink, fontSize: 22, lineHeight: 31, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm },
  h3: { color: colors.ink, fontSize: 20, lineHeight: 29, fontWeight: "700", marginTop: spacing.md, marginBottom: spacing.sm },
  body: { color: colors.ink, fontSize: 16, lineHeight: 27, marginBottom: spacing.md, flexShrink: 1 },
  bold: { fontWeight: "700" },
  list: { marginBottom: spacing.sm },
  listItem: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.sm },
  marker: { color: colors.primary, width: 28, fontSize: 16, lineHeight: 27, fontWeight: "700" },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md, marginVertical: spacing.sm },
  quoteText: { color: colors.inkSoft, fontSize: 16, lineHeight: 26, fontStyle: "italic" },
  expandButton: { minHeight: 44, justifyContent: "center", alignItems: "center", marginTop: spacing.sm },
  expandText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
});
