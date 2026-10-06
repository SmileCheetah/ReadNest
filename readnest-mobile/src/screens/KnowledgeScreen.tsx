import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { knowledgeApi } from "../api/knowledgeApi";
import { ApiError, readnestApi, type ApiArticle } from "../api/readnestApi";
import { mapArticleToThread } from "../api/articleMapper";
import type { SavedThread } from "../data/mockThreads";
import { validateTopicInput, type KnowledgeTopic } from "../data/knowledge";
import {
  knowledgeError,
  useKnowledgePage,
  useKnowledgeSearch,
} from "../hooks/useKnowledgeLibrary";
import { colors, radius, spacing } from "../theme/tokens";

type Props = {
  token: string;
  onBack: () => void;
  onOpenThread: (thread: SavedThread) => void;
  initialArticle?: SavedThread;
  active?: boolean;
};
type Editor = {
  topic?: KnowledgeTopic;
  name: string;
  description: string;
  initialName: string;
  initialDescription: string;
  latest?: KnowledgeTopic;
};

function Action({
  label,
  accessibilityLabel = label,
  onPress,
  disabled,
  primary,
  danger,
  icon,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.primaryAction,
        danger && styles.dangerAction,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={18}
          color={
            primary
              ? colors.surface
              : danger
                ? colors.red
                : colors.primaryPressed
          }
        />
      )}
      <Text
        style={[
          styles.actionText,
          primary && styles.primaryText,
          danger && styles.dangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function Search({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <View style={styles.search}>
      <Ionicons name="search-outline" size={20} color={colors.muted} />
      <TextInput
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        style={styles.searchInput}
        autoCorrect={false}
        returnKeyType="search"
      />
      {!!value && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="검색어 지우기"
          onPress={() => onChange("")}
          style={styles.iconAction}
        >
          <Ionicons name="close-outline" size={22} color={colors.inkSoft} />
        </Pressable>
      )}
    </View>
  );
}
function ListStatus({
  loading,
  error,
  empty,
  emptyText,
  hasMore,
  onMore,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  hasMore: boolean;
  onMore: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={styles.listFooter}>
      {loading && (
        <View style={styles.inline}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.caption}>불러오는 중…</Text>
        </View>
      )}
      {!!error && (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.error}>{error}</Text>
          <Action label="다시 불러오기" onPress={onRetry} />
        </View>
      )}
      {!loading && !error && empty && (
        <Text style={styles.empty}>{emptyText}</Text>
      )}
      {!loading && !error && hasMore && (
        <Action label="더 불러오기" onPress={onMore} />
      )}
    </View>
  );
}

/** Manual organization only: visiting or selecting articles never generates AI content or marks them read. */
export function KnowledgeScreen(props: Props) {
  return (
    <KnowledgeScreenContent
      key={`${props.token}:${props.initialArticle?.id ?? "browse"}`}
      {...props}
    />
  );
}

function KnowledgeScreenContent({
  token,
  onBack,
  onOpenThread,
  initialArticle,
  active = true,
}: Props) {
  const insets = useSafeAreaInsets();
  const [topic, setTopic] = useState<KnowledgeTopic | null>(null);
  const [topicSearch, setTopicSearch] = useState("");
  const [articleSearch, setArticleSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(
    new Set(),
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [memberships, setMemberships] = useState<Set<string>>(new Set());
  const [chosenTopics, setChosenTopics] = useState<Set<string>>(new Set());
  const [membershipLoading, setMembershipLoading] = useState(!!initialArticle);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [membershipRetry, setMembershipRetry] = useState(0);
  const epoch = useRef(0);
  const tokenRef = useRef(token);
  if (tokenRef.current !== token) {
    tokenRef.current = token;
    epoch.current++;
  }
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  const topicQuery = useKnowledgeSearch(topicSearch);
  const articleQuery = useKnowledgeSearch(articleSearch);
  const topics = useKnowledgePage(
    `${token}:topics:${topicQuery}`,
    (cursor, signal) =>
      knowledgeApi.listTopics(token, { search: topicQuery, cursor, signal }),
  );
  const articles = useKnowledgePage<ApiArticle>(
    `${token}:${topic?.id}:${picker}:${articleQuery}`,
    (cursor, signal) =>
      picker
        ? readnestApi.listArticlePage(token, {
            period: "all",
            search: articleQuery,
            cursor,
            signal,
          })
        : knowledgeApi.listArticles(token, topic!.id, {
            search: articleQuery,
            cursor,
            signal,
          }),
    !!topic && !initialArticle && !editor,
  );

  useEffect(() => {
    if (!initialArticle) return;
    const controller = new AbortController();
    const captured = epoch.current;
    setMembershipLoading(true);
    setMembershipError(null);
    void (async () => {
      try {
        const ids = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await knowledgeApi.articleTopics(
            token,
            initialArticle.id,
            { cursor, signal: controller.signal },
          );
          if (controller.signal.aborted || captured !== epoch.current) return;
          page.items.forEach((item) => ids.add(item.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        setMemberships(ids);
        setChosenTopics(new Set(ids));
      } catch (caught) {
        if (!controller.signal.aborted && captured === epoch.current)
          setMembershipError(knowledgeError(caught));
      } finally {
        if (!controller.signal.aborted && captured === epoch.current)
          setMembershipLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, initialArticle?.id, membershipRetry]);

  const wasActive = useRef(active);
  const refreshSequence = useRef(0);
  useEffect(() => {
    const refresh = ++refreshSequence.current;
    const returning = active && !wasActive.current;
    wasActive.current = active;
    if (!returning || editor || picker || initialArticle) return;
    void topics.reload();
    if (topic) {
      const captured = epoch.current;
      const id = topic.id;
      void articles.reload();
      void knowledgeApi
        .getTopic(token, id)
        .then((fresh) => {
          if (captured === epoch.current && refresh === refreshSequence.current)
            setTopic((current) =>
              current?.id === id && fresh.revision >= current.revision
                ? fresh
                : current,
            );
        })
        .catch((caught) => {
          if (captured === epoch.current && refresh === refreshSequence.current)
            setError(knowledgeError(caught));
        });
    }
  }, [active]);

  const membershipDirty =
    memberships.size !== chosenTopics.size ||
    [...memberships].some((id) => !chosenTopics.has(id));
  const editorDirty =
    !!editor &&
    (editor.name !== editor.initialName ||
      editor.description !== editor.initialDescription);
  function clearFeedback() {
    setError(null);
    setNotice(null);
    setConflict(false);
  }
  function goBack() {
    refreshSequence.current++;
    setDiscardConfirm(false);
    clearFeedback();
    if (editor) setEditor(null);
    else if (deleteConfirm) setDeleteConfirm(false);
    else if (picker) {
      setPicker(false);
      setSelectedArticles(new Set());
      setArticleSearch("");
    } else if (topic) {
      setTopic(null);
      setArticleSearch("");
    } else onBack();
  }
  function requestBack() {
    if (busyRef.current) {
      setNotice("저장 중이에요. 완료 후 이동해 주세요.");
      return;
    }
    if (discardConfirm) {
      setDiscardConfirm(false);
      return;
    }
    if (deleteConfirm) {
      setDeleteConfirm(false);
      return;
    }
    if (
      editorDirty ||
      (picker && selectedArticles.size > 0) ||
      (!editor && initialArticle && membershipDirty)
    )
      setDiscardConfirm(true);
    else goBack();
  }
  useEffect(() => {
    if (!active) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      requestBack();
      return true;
    });
    return () => listener.remove();
  });

  async function mutate(work: (current: () => boolean) => Promise<void>) {
    if (busyRef.current) return;
    refreshSequence.current++;
    const captured = epoch.current;
    const current = () => captured === epoch.current;
    busyRef.current = true;
    setBusy(true);
    clearFeedback();
    try {
      await work(current);
    } catch (caught) {
      if (current()) {
        setError(knowledgeError(caught));
        setConflict(
          caught instanceof ApiError &&
            caught.status === 409 &&
            caught.code !== "TOPIC_NAME_EXISTS" &&
            !!editor?.topic,
        );
      }
    } finally {
      if (current()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function openEditor(value?: KnowledgeTopic) {
    refreshSequence.current++;
    clearFeedback();
    setEditor({
      topic: value,
      name: value?.name ?? "",
      description: value?.description ?? "",
      initialName: value?.name ?? "",
      initialDescription: value?.description ?? "",
    });
  }
  function openTopic(value: KnowledgeTopic) {
    refreshSequence.current++;
    clearFeedback();
    setTopic(value);
    setArticleSearch("");
  }
  function toggle(
    setter: (fn: (old: Set<string>) => Set<string>) => void,
    id: string,
  ) {
    setter((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function saveTopic() {
    if (!editor) return;
    const issue = validateTopicInput(editor.name, editor.description);
    if (issue) {
      setError(issue);
      return;
    }
    void mutate(async (current) => {
      const input = {
        name: editor.name.trim(),
        description: editor.description.trim(),
      };
      const saved = editor.topic
        ? await knowledgeApi.updateTopic(token, editor.topic.id, {
            ...input,
            expectedRevision: editor.topic.revision,
          })
        : await knowledgeApi.createTopic(token, input);
      if (!current()) return;
      setEditor(null);
      if (initialArticle) {
        setChosenTopics((old) => new Set([...old, saved.id]));
        setNotice("주제를 만들었어요. 연결 저장을 누르면 이 글이 연결됩니다.");
      } else {
        setTopic(saved);
        setNotice("주제를 저장했어요.");
      }
      setTopicSearch("");
      void topics.reload();
    });
  }
  function saveMemberships() {
    if (!initialArticle || membershipLoading || membershipError) return;
    void mutate(async (current) => {
      const adds = [...chosenTopics].filter((id) => !memberships.has(id));
      const removes = [...memberships].filter((id) => !chosenTopics.has(id));
      const baseline = new Set(memberships);
      let failures = 0;
      for (const [ids, add] of [
        [adds, true],
        [removes, false],
      ] as const) {
        for (const id of ids) {
          try {
            if (add)
              await knowledgeApi.linkArticle(token, id, initialArticle.id);
            else await knowledgeApi.unlinkArticle(token, id, initialArticle.id);
            if (!current()) return;
            if (add) baseline.add(id);
            else baseline.delete(id);
          } catch {
            failures++;
          }
          if (!current()) return;
        }
      }
      setMemberships(baseline);
      void topics.reload();
      if (failures)
        setError(
          `${failures}개 주제의 변경을 저장하지 못했어요. 선택은 유지되며 연결 저장으로 다시 시도할 수 있어요.`,
        );
      else setNotice("주제 연결을 저장했어요. 저장글은 그대로 유지됩니다.");
    });
  }
  function addSelectedArticles() {
    if (!topic || !selectedArticles.size) return;
    void mutate(async (current) => {
      const remaining = new Set(selectedArticles);
      let updated = topic;
      for (const id of selectedArticles) {
        try {
          updated = await knowledgeApi.linkArticle(token, topic.id, id);
          if (!current()) return;
          remaining.delete(id);
        } catch {
          /* Keep failed selections available for retry, including off-page ones. */
        }
        if (!current()) return;
      }
      setTopic(updated);
      setSelectedArticles(remaining);
      void topics.reload();
      if (remaining.size)
        setError(
          `${remaining.size}개 글을 연결하지 못했어요. 선택한 글 연결을 눌러 다시 시도해 주세요.`,
        );
      else {
        setPicker(false);
        setArticleSearch("");
        setNotice("선택한 글을 주제에 연결했어요.");
      }
    });
  }

  const pageTitle = editor
    ? editor.topic
      ? "주제 편집"
      : "새 주제 만들기"
    : initialArticle
      ? "주제에 추가"
      : picker
        ? "연결할 글 선택"
        : topic
          ? topic.name
          : "주제로 모아보기";
  const pageStatus = articles;
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={requestBack}
          style={styles.iconAction}
        >
          <Ionicons
            name="arrow-back-outline"
            size={24}
            color={colors.inkSoft}
          />
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerText}>
          {editor ? "주제 정리" : "내 지식 모음"}
        </Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xl },
        ]}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {pageTitle}
        </Text>
        {!!error && (
          <View accessibilityLiveRegion="polite" style={styles.errorBox}>
            <Text style={styles.error}>{error}</Text>
          </View>
        )}
        {!!notice && (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        )}
        {discardConfirm ? (
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              변경 사항을 저장하지 않고 나갈까요?
            </Text>
            <Text style={styles.body}>
              저장하지 않은 입력과 선택은 사라집니다. 이미 저장된 글과 주제는
              유지됩니다.
            </Text>
            <Action
              label="계속 작성하기"
              onPress={() => setDiscardConfirm(false)}
              primary
            />
            <Action label="변경 버리고 나가기" onPress={goBack} danger />
          </View>
        ) : editor ? (
          <View style={styles.form}>
            <Text style={styles.label}>주제 이름</Text>
            <TextInput
              accessibilityLabel="주제 이름"
              style={styles.input}
              value={editor.name}
              onChangeText={(name) => setEditor({ ...editor, name })}
              placeholder="예: AI 업무 활용"
              placeholderTextColor={colors.muted}
              editable={!busy}
              autoFocus
            />
            <Text style={styles.caption}>
              {Array.from(editor.name).length}/80자
            </Text>
            <Text style={styles.label}>설명 (선택)</Text>
            <TextInput
              accessibilityLabel="주제 설명"
              style={[styles.input, styles.descriptionInput]}
              multiline
              textAlignVertical="top"
              value={editor.description}
              onChangeText={(description) =>
                setEditor({ ...editor, description })
              }
              placeholder="이 주제로 어떤 글을 모으고 싶나요?"
              placeholderTextColor={colors.muted}
              editable={!busy}
            />
            <Text style={styles.caption}>
              {Array.from(editor.description).length}/2,000자
            </Text>
            {conflict && (
              <View style={styles.panel}>
                <Text style={styles.body}>
                  다른 변경과 충돌했을 수 있어요. 입력은 보존했습니다. 최신
                  정보를 확인한 뒤 다시 저장해 주세요.
                </Text>
                <Action
                  label="최신 정보 확인"
                  disabled={busy}
                  onPress={() =>
                    void mutate(async (current) => {
                      const latest = await knowledgeApi.getTopic(
                        token,
                        editor.topic!.id,
                      );
                      if (current()) {
                        setEditor({ ...editor, topic: latest, latest });
                        setNotice(
                          "입력은 유지했어요. 최신 내용과 비교한 뒤 저장해 주세요.",
                        );
                      }
                    })
                  }
                />
              </View>
            )}
            {editor.latest && (
              <View style={styles.panel}>
                <Text style={styles.label}>서버에 저장된 최신 내용</Text>
                <Text style={styles.body}>{editor.latest.name}</Text>
                <Text style={styles.caption}>
                  {editor.latest.description || "설명 없음"}
                </Text>
              </View>
            )}
            <Action
              label={busy ? "저장 중…" : "주제 저장"}
              onPress={saveTopic}
              disabled={busy || conflict}
              primary
            />
            <Action label="취소" onPress={requestBack} disabled={busy} />
          </View>
        ) : deleteConfirm && topic ? (
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              ‘{topic.name}’ 주제를 삭제할까요?
            </Text>
            <Text style={styles.body}>
              주제와 연결만 삭제합니다. 연결된 {topic.articleCount}개의 저장글과
              요약은 보관함에 그대로 남습니다.
            </Text>
            <Action
              label="주제 삭제 확인"
              danger
              disabled={busy}
              onPress={() =>
                void mutate(async (current) => {
                  await knowledgeApi.deleteTopic(token, topic.id);
                  if (current()) {
                    setTopic(null);
                    setDeleteConfirm(false);
                    setNotice(
                      "주제만 삭제했어요. 저장글은 보관함에 남아 있어요.",
                    );
                    void topics.reload();
                  }
                })
              }
            />
            <Action
              label="삭제 취소"
              onPress={() => setDeleteConfirm(false)}
              disabled={busy}
            />
          </View>
        ) : !topic || initialArticle ? (
          <>
            <Text style={styles.body}>
              {initialArticle
                ? "이 글을 다시 찾기 좋은 주제를 선택하세요. 여러 주제에 연결할 수 있습니다."
                : "따로 저장했던 글들을 하나의 관심사로 연결해 보세요. 직접 만든 주제는 요약 태그와 별도로 보관됩니다."}
            </Text>
            {initialArticle && (
              <Text style={styles.sourceTitle}>{initialArticle.title}</Text>
            )}
            <Action
              label="새 주제 만들기"
              icon="add-outline"
              onPress={() => openEditor()}
              disabled={busy || membershipLoading}
              primary={!initialArticle}
            />
            <Search
              value={topicSearch}
              onChange={setTopicSearch}
              label="주제 검색"
            />
            {initialArticle &&
              (membershipLoading ? (
                <Text style={styles.caption}>
                  연결된 주제를 확인하고 있어요…
                </Text>
              ) : membershipError ? (
                <View>
                  <Text style={styles.error}>{membershipError}</Text>
                  <Action
                    label="주제 연결 다시 불러오기"
                    onPress={() => setMembershipRetry((value) => value + 1)}
                  />
                </View>
              ) : (
                <Text style={styles.caption}>
                  {chosenTopics.size}개 주제 선택 · 검색해도 선택은 유지됩니다.
                </Text>
              ))}
            <View style={styles.collection}>
              {topics.items.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole={initialArticle ? "checkbox" : "button"}
                  accessibilityLabel={
                    initialArticle
                      ? `${item.name} 주제 선택`
                      : `${item.name}, 글 ${item.articleCount}개`
                  }
                  accessibilityState={
                    initialArticle
                      ? {
                          checked: chosenTopics.has(item.id),
                          disabled:
                            busy || membershipLoading || !!membershipError,
                        }
                      : undefined
                  }
                  aria-checked={
                    initialArticle ? chosenTopics.has(item.id) : undefined
                  }
                  aria-disabled={
                    busy ||
                    (!!initialArticle &&
                      (membershipLoading || !!membershipError))
                  }
                  disabled={
                    busy ||
                    (!!initialArticle &&
                      (membershipLoading || !!membershipError))
                  }
                  onPress={() =>
                    initialArticle
                      ? toggle(setChosenTopics, item.id)
                      : openTopic(item)
                  }
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  {initialArticle && (
                    <Ionicons
                      name={
                        chosenTopics.has(item.id)
                          ? "checkbox"
                          : "square-outline"
                      }
                      size={24}
                      color={
                        chosenTopics.has(item.id)
                          ? colors.primary
                          : colors.muted
                      }
                    />
                  )}
                  <View style={styles.rowContent}>
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    {!!item.description && (
                      <Text style={styles.caption}>{item.description}</Text>
                    )}
                    <Text style={styles.metadata}>
                      글 {item.articleCount}개
                    </Text>
                  </View>
                  {!initialArticle && (
                    <Ionicons
                      name="chevron-forward-outline"
                      size={20}
                      color={colors.muted}
                    />
                  )}
                </Pressable>
              ))}
            </View>
            <ListStatus
              {...topics}
              empty={!topics.items.length}
              emptyText={
                topicQuery
                  ? "일치하는 주제가 없어요. 다른 검색어로 찾아보세요."
                  : "아직 주제가 없어요. 관심 있는 주제를 하나 만들어 시작해 보세요."
              }
              hasMore={!!topics.cursor}
              onMore={() => void topics.loadMore()}
              onRetry={() => void topics.retry()}
            />
            {initialArticle && (
              <Action
                label={busy ? "연결 저장 중…" : "연결 저장"}
                primary
                disabled={
                  busy ||
                  membershipLoading ||
                  !!membershipError ||
                  !membershipDirty
                }
                onPress={saveMemberships}
              />
            )}
          </>
        ) : (
          <>
            {picker ? (
              <>
                <Text style={styles.body}>
                  ‘{topic.name}’에 모을 저장글을 선택하세요. 이미 연결된 글은
                  중복되지 않습니다.
                </Text>
                <Text style={styles.caption}>
                  {selectedArticles.size}개 선택 · 검색하거나 더 불러와도 선택은
                  유지됩니다.
                </Text>
                <Action
                  label={busy ? "연결 중…" : "선택한 글 연결"}
                  primary
                  disabled={busy || !selectedArticles.size}
                  onPress={addSelectedArticles}
                />
              </>
            ) : (
              <>
                {!!topic.description && (
                  <Text style={styles.body}>{topic.description}</Text>
                )}
                <Text style={styles.caption}>
                  직접 모은 글 {topic.articleCount}개
                </Text>
                <Action
                  label="저장글 연결"
                  icon="add-outline"
                  primary
                  onPress={() => {
                    setPicker(true);
                    setArticleSearch("");
                    clearFeedback();
                  }}
                  disabled={busy}
                />
                <View style={styles.inline}>
                  <Action
                    label="주제 편집"
                    onPress={() => openEditor(topic)}
                    disabled={busy}
                  />
                  <Action
                    label="주제 삭제"
                    onPress={() => {
                      clearFeedback();
                      setDeleteConfirm(true);
                    }}
                    disabled={busy}
                    danger
                  />
                </View>
              </>
            )}
            <Search
              value={articleSearch}
              onChange={setArticleSearch}
              label={picker ? "저장한 글 검색" : "이 주제에서 글 검색"}
            />
            <Text style={styles.metadata}>제목·요약·URL로 검색합니다.</Text>
            <View style={styles.collection}>
              {articles.items.map((article) => (
                <View key={article.id} style={styles.articleRow}>
                  <Pressable
                    accessibilityRole={picker ? "checkbox" : "button"}
                    accessibilityLabel={
                      picker
                        ? `${article.title || "저장한 글"} 선택`
                        : `${article.title || "저장한 글"} 읽기`
                    }
                    accessibilityState={
                      picker
                        ? {
                            checked: selectedArticles.has(article.id),
                            disabled: busy,
                          }
                        : undefined
                    }
                    aria-checked={
                      picker ? selectedArticles.has(article.id) : undefined
                    }
                    aria-disabled={busy}
                    disabled={busy}
                    onPress={() =>
                      picker
                        ? toggle(setSelectedArticles, article.id)
                        : onOpenThread(mapArticleToThread(article))
                    }
                    style={({ pressed }) => [
                      styles.articlePress,
                      pressed && styles.pressed,
                    ]}
                  >
                    {picker && (
                      <Ionicons
                        name={
                          selectedArticles.has(article.id)
                            ? "checkbox"
                            : "square-outline"
                        }
                        size={24}
                        color={
                          selectedArticles.has(article.id)
                            ? colors.primary
                            : colors.muted
                        }
                      />
                    )}
                    <View style={styles.rowContent}>
                      <Text style={styles.rowTitle}>
                        {article.title || "저장한 글"}
                      </Text>
                      {!!article.summaryPreview && (
                        <Text style={styles.caption}>
                          {article.summaryPreview}
                        </Text>
                      )}
                      <Text style={styles.metadata}>
                        Threads ·{" "}
                        {new Date(article.savedAt).toLocaleDateString("ko-KR")}
                      </Text>
                    </View>
                  </Pressable>
                  {!picker && (
                    <Action
                      label="연결 해제"
                      accessibilityLabel={`${article.title || "저장한 글"} 연결 해제`}
                      icon="remove-circle-outline"
                      disabled={busy}
                      onPress={() =>
                        void mutate(async (current) => {
                          const updated = await knowledgeApi.unlinkArticle(
                            token,
                            topic.id,
                            article.id,
                          );
                          if (current()) {
                            setTopic(updated);
                            setNotice(
                              "주제 연결만 해제했어요. 저장글은 그대로 남아 있어요.",
                            );
                            void articles.reload();
                            void topics.reload();
                          }
                        })
                      }
                    />
                  )}
                </View>
              ))}
            </View>
            <ListStatus
              {...pageStatus}
              empty={!articles.items.length}
              emptyText={
                articleQuery
                  ? "검색 결과가 없어요. 다른 검색어로 찾아보세요."
                  : picker
                    ? "아직 저장한 글이 없어요. 보관함으로 돌아가 Threads 링크를 저장해 주세요."
                    : "아직 연결된 글이 없어요. 저장글 연결로 이 주제에 글을 모아보세요."
              }
              hasMore={!!articles.cursor}
              onMore={() => void articles.loadMore()}
              onRetry={() => void articles.retry()}
            />
            {picker && (
              <Action label="선택 취소" onPress={requestBack} disabled={busy} />
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.paper,
  },
  headerText: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "700",
    color: colors.ink,
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  title: { fontSize: 26, lineHeight: 34, fontWeight: "700", color: colors.ink },
  body: { fontSize: 16, lineHeight: 27, color: colors.inkSoft },
  caption: { fontSize: 14, lineHeight: 22, color: colors.muted },
  metadata: { fontSize: 12, lineHeight: 20, color: colors.muted },
  sourceTitle: {
    fontSize: 16,
    lineHeight: 25,
    color: colors.ink,
    fontWeight: "600",
    paddingVertical: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.hairline,
    paddingLeft: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 26,
    color: colors.ink,
    fontWeight: "700",
  },
  action: {
    minHeight: 48,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.blueSoft,
    flexShrink: 1,
  },
  primaryAction: { backgroundColor: colors.primary },
  dangerAction: { backgroundColor: colors.redSoft },
  actionText: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.primaryPressed,
    fontWeight: "600",
    flexShrink: 1,
  },
  primaryText: { color: colors.surface },
  dangerText: { color: colors.red },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  iconAction: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  inline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingVertical: 12,
    paddingRight: spacing.sm,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  collection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowContent: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowTitle: {
    fontSize: 17,
    lineHeight: 26,
    fontWeight: "600",
    color: colors.ink,
    flexShrink: 1,
  },
  articleRow: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  articlePress: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
  },
  listFooter: { gap: spacing.sm, alignItems: "stretch" },
  empty: {
    fontSize: 16,
    lineHeight: 27,
    color: colors.muted,
    paddingVertical: spacing.lg,
  },
  form: { gap: spacing.sm },
  label: { fontSize: 15, lineHeight: 24, color: colors.ink, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    minHeight: 48,
    padding: 12,
    fontSize: 16,
    lineHeight: 26,
    color: colors.ink,
  },
  descriptionInput: { minHeight: 120 },
  panel: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    gap: spacing.md,
  },
  errorBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.redSoft,
  },
  error: { fontSize: 15, lineHeight: 24, color: colors.red },
  notice: { fontSize: 15, lineHeight: 24, color: colors.inkSoft },
});
