import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as SecureStore from "expo-secure-store";
import * as ExpoLinking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE_URL, ApiUser, readnestApi } from "./src/api/readnestApi";
import { mapArticleToThread } from "./src/api/articleMapper";
import { AppHeader } from "./src/components/AppHeader";
import { BottomNav } from "./src/components/BottomNav";
import { ThreadCard } from "./src/components/ThreadCard";
import { SavedThread } from "./src/data/mockThreads";
import { colors, radius, shadow, spacing } from "./src/theme/tokens";

export type ScreenName = "home" | "archive" | "settings";
type ArchiveReadFilter = "ALL" | "UNREAD" | "READ" | "READ_LATER";
type ArchivePeriod = "today" | "week" | "last-week" | "month" | "all";

const archiveTabs = ["오늘", "이번 주", "지난주", "이번 달", "월별 아카이브"];
const TOKEN_STORAGE_KEY = "readnest.accessToken";

function mapArchiveTabToPeriod(tab: string): ArchivePeriod {
  const periodByTab: Record<string, ArchivePeriod> = {
    오늘: "today",
    "이번 주": "week",
    지난주: "last-week",
    "이번 달": "month",
    "월별 아카이브": "all",
  };

  return periodByTab[tab] ?? "all";
}

export default function App() {
  const [screen, setScreen] = useState<ScreenName>("home");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [threads, setThreads] = useState<SavedThread[]>([]);
  const [archiveThreads, setArchiveThreads] = useState<SavedThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<SavedThread | null>(
    null,
  );
  const [activeArchiveTab, setActiveArchiveTab] = useState("오늘");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveReadFilter, setArchiveReadFilter] =
    useState<ArchiveReadFilter>("ALL");
  const [url, setUrl] = useState("");
  const [pendingSharedUrl, setPendingSharedUrl] = useState<string | null>(null);
  const [isLoadingArticles, setIsLoadingArticles] = useState(false);
  const [isLoadingArchive, setIsLoadingArchive] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [isSavingArticle, setIsSavingArticle] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const todayThreads = useMemo(
    () => threads.filter((thread) => thread.savedDateLabel === "오늘"),
    [threads],
  );
  const summarizingThreads = useMemo(
    () => threads.filter((thread) => thread.processStatus === "SUMMARIZING"),
    [threads],
  );
  const unreadThreads = useMemo(
    () => threads.filter((thread) => thread.readStatus === "UNREAD"),
    [threads],
  );
  const todayReadingThreads = useMemo(() => {
    const priority = {
      READ_LATER: 0,
      UNREAD: 1,
      READ: 2,
    } as const;

    return threads
      .filter(
        (thread) =>
          thread.processStatus === "SUMMARY_DONE" &&
          (thread.readStatus === "UNREAD" ||
            thread.readStatus === "READ_LATER"),
      )
      .sort((a, b) => priority[a.readStatus] - priority[b.readStatus])
      .slice(0, 3);
  }, [threads]);

  const refreshArticles = useCallback(async () => {
    if (!accessToken) return;

    setIsLoadingArticles(true);
    setErrorMessage(null);

    try {
      const articles = await readnestApi.listArticles(accessToken);
      setThreads(articles.map(mapArticleToThread));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "저장글을 불러오지 못했습니다.",
      );
    } finally {
      setIsLoadingArticles(false);
    }
  }, [accessToken]);

  const refreshArchiveArticles = useCallback(async () => {
    if (!accessToken) return;

    setIsLoadingArchive(true);
    setErrorMessage(null);

    try {
      const articles = await readnestApi.listArticles(accessToken, {
        period: mapArchiveTabToPeriod(activeArchiveTab),
        readStatus:
          archiveReadFilter === "ALL" ? undefined : archiveReadFilter,
        search: archiveSearch,
        limit: 100,
      });
      setArchiveThreads(articles.map(mapArticleToThread));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "아카이브를 불러오지 못했습니다.",
      );
    } finally {
      setIsLoadingArchive(false);
    }
  }, [accessToken, activeArchiveTab, archiveReadFilter, archiveSearch]);

  useEffect(() => {
    void refreshArticles();
  }, [refreshArticles]);

  useEffect(() => {
    if (screen !== "archive") return;

    const timeoutId = setTimeout(() => {
      void refreshArchiveArticles();
    }, 250);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [refreshArchiveArticles, screen]);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync(TOKEN_STORAGE_KEY);

        if (!storedToken) return;

        const me = await readnestApi.me(storedToken);
        setAccessToken(storedToken);
        setUser(me);
      } catch {
        await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
      } finally {
        setIsRestoringSession(false);
      }
    };

    void restoreSession();
  }, []);

  useEffect(() => {
    const handleIncomingUrl = (incomingUrl: string | null) => {
      if (!incomingUrl) return;

      const parsed = ExpoLinking.parse(incomingUrl);
      const sharedUrl = parsed.queryParams?.url;

      if (typeof sharedUrl === "string") {
        setUrl(sharedUrl);
        setPendingSharedUrl(sharedUrl);
      }
    };

    ExpoLinking.getInitialURL()
      .then(handleIncomingUrl)
      .catch(() => undefined);

    const subscription = ExpoLinking.addEventListener("url", (event) => {
      handleIncomingUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const saveThreadUrl = async () => {
    if (!accessToken) return;

    if (!url.trim()) {
      Alert.alert(
        "URL을 입력해 주세요",
        "Threads 링크를 붙여넣으면 저장할 수 있습니다.",
      );
      return;
    }

    setIsSavingArticle(true);
    setErrorMessage(null);

    try {
      const article = await readnestApi.createArticle(accessToken, {
        url: url.trim(),
      });
      const nextThread = mapArticleToThread(article);
      setThreads((current) => [
        nextThread,
        ...current.filter((thread) => thread.id !== nextThread.id),
      ]);
      setUrl("");
      setPendingSharedUrl(null);
      Alert.alert("저장 완료", "Threads URL이 ReadNest에 저장되었습니다.");
      setTimeout(() => {
        void refreshArticles();
        void refreshArchiveArticles();
      }, 2500);
    } catch (error) {
      Alert.alert(
        "저장 실패",
        error instanceof Error
          ? error.message
          : "URL 저장 중 문제가 발생했습니다.",
      );
    } finally {
      setIsSavingArticle(false);
    }
  };

  const openThread = async (thread: SavedThread) => {
    setSelectedThread(thread);

    if (!accessToken) return;

    try {
      const article = await readnestApi.getArticle(accessToken, thread.id);
      const detailedThread = mapArticleToThread(article);
      setSelectedThread(detailedThread);
      setThreads((current) =>
        current.map((item) =>
          item.id === detailedThread.id ? detailedThread : item,
        ),
      );
      setArchiveThreads((current) =>
        current.map((item) =>
          item.id === detailedThread.id ? detailedThread : item,
        ),
      );
    } catch {
      // Keep the list item open if the detail refresh fails.
    }
  };

  const changeThreadReadStatus = async (
    thread: SavedThread,
    nextStatus: SavedThread["readStatus"],
  ) => {
    if (!accessToken) return;

    try {
      const article = await readnestApi.updateReadStatus(
        accessToken,
        thread.id,
        nextStatus,
      );
      const nextThread = mapArticleToThread(article);

      setThreads((current) =>
        current.map((item) => (item.id === nextThread.id ? nextThread : item)),
      );
      setArchiveThreads((current) =>
        current.map((item) => (item.id === nextThread.id ? nextThread : item)),
      );
      setSelectedThread(nextThread);
      void refreshArchiveArticles();
    } catch (error) {
      Alert.alert(
        "상태 변경 실패",
        error instanceof Error
          ? error.message
          : "읽음 상태를 변경하지 못했습니다.",
      );
    }
  };

  const updateThreadReadStatus = async (thread: SavedThread) => {
    await changeThreadReadStatus(
      thread,
      thread.readStatus === "READ" ? "UNREAD" : "READ",
    );
  };

  const markThreadReadLater = async (thread: SavedThread) => {
    await changeThreadReadStatus(thread, "READ_LATER");
  };

  const retryThreadSummary = async (thread: SavedThread) => {
    if (!accessToken) return;

    try {
      const article = await readnestApi.retrySummary(accessToken, thread.id);
      const nextThread = mapArticleToThread(article);

      setThreads((current) =>
        current.map((item) => (item.id === nextThread.id ? nextThread : item)),
      );
      setArchiveThreads((current) =>
        current.map((item) => (item.id === nextThread.id ? nextThread : item)),
      );
      setSelectedThread(nextThread);
      Alert.alert("재시도 시작", "요약을 다시 생성하고 있습니다.");
      setTimeout(() => {
        void refreshArticles();
        void refreshArchiveArticles();
      }, 2500);
    } catch (error) {
      Alert.alert(
        "재시도 실패",
        error instanceof Error
          ? error.message
          : "요약 재시도를 시작하지 못했습니다.",
      );
    }
  };

  const copyThreadSummary = async (thread: SavedThread) => {
    await Clipboard.setStringAsync(formatThreadShareText(thread));
    Alert.alert("복사 완료", "요약 내용이 클립보드에 복사되었습니다.");
  };

  const shareThreadSummary = async (thread: SavedThread) => {
    try {
      await Share.share({
        message: formatThreadShareText(thread),
      });
    } catch (error) {
      Alert.alert(
        "공유 실패",
        error instanceof Error ? error.message : "요약을 공유하지 못했습니다.",
      );
    }
  };

  const deleteThread = async (thread: SavedThread) => {
    if (!accessToken) return;

    Alert.alert("요약본 삭제", "이 저장글과 AI 요약을 삭제할까요?", [
      {
        text: "취소",
        style: "cancel",
      },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await readnestApi.deleteArticle(accessToken, thread.id);
            setThreads((current) =>
              current.filter((item) => item.id !== thread.id),
            );
            setArchiveThreads((current) =>
              current.filter((item) => item.id !== thread.id),
            );
            setSelectedThread(null);
          } catch (error) {
            Alert.alert(
              "삭제 실패",
              error instanceof Error
                ? error.message
                : "요약본을 삭제하지 못했습니다.",
            );
          }
        },
      },
    ]);
  };

  const handleAuthSuccess = async (response: {
    accessToken: string;
    user: ApiUser;
  }) => {
    await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, response.accessToken);
    setAccessToken(response.accessToken);
    setUser(response.user);
    setScreen("home");
    setErrorMessage(null);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
    setAccessToken(null);
    setUser(null);
    setThreads([]);
    setArchiveThreads([]);
    setSelectedThread(null);
    setScreen("home");
  };

  if (isRestoringSession) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar style="dark" />
          <View style={styles.authRoot}>
            <Text style={styles.loadingText}>로그인 상태를 확인하는 중...</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!accessToken || !user) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar style="dark" />
          <AuthScreen onAuthSuccess={handleAuthSuccess} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        {selectedThread ? (
          <ThreadDetail
            thread={selectedThread}
            onBack={() => setSelectedThread(null)}
            onToggleReadStatus={updateThreadReadStatus}
            onMarkReadLater={markThreadReadLater}
            onRetrySummary={retryThreadSummary}
            onCopySummary={copyThreadSummary}
            onShareSummary={shareThreadSummary}
            onDelete={deleteThread}
          />
        ) : (
          <KeyboardAvoidingView
            style={styles.app}
            behavior={Platform.select({ ios: "padding", android: undefined })}
          >
            <AppHeader
              subtitle={
                screen === "home"
                  ? "Threads에서 발견한 좋은 글을 저장하고 요약하세요."
                  : undefined
              }
            />
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {screen === "home" ? (
                <HomeScreen
                  url={url}
                  onChangeUrl={setUrl}
                  onSave={saveThreadUrl}
                  isSaving={isSavingArticle}
                  isLoading={isLoadingArticles}
                  errorMessage={errorMessage}
                  pendingSharedUrl={pendingSharedUrl}
                  todayReadingThreads={todayReadingThreads}
                  todayThreads={todayThreads}
                  summarizingThreads={summarizingThreads}
                  unreadThreads={unreadThreads}
                  onShowUnread={() => {
                    setScreen("archive");
                    setArchiveReadFilter("UNREAD");
                    setActiveArchiveTab("월별 아카이브");
                  }}
                  onOpenThread={(thread) => void openThread(thread)}
                />
              ) : null}
              {screen === "archive" ? (
                <ArchiveScreen
                  activeTab={activeArchiveTab}
                  onChangeTab={setActiveArchiveTab}
                  search={archiveSearch}
                  onChangeSearch={setArchiveSearch}
                  readFilter={archiveReadFilter}
                  onChangeReadFilter={setArchiveReadFilter}
                  threads={archiveThreads}
                  isLoading={isLoadingArchive}
                  onOpenThread={(thread) => void openThread(thread)}
                />
              ) : null}
              {screen === "settings" ? (
                <SettingsScreen user={user} onLogout={logout} />
              ) : null}
            </ScrollView>
            <BottomNav current={screen} onChange={setScreen} />
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function formatThreadShareText(thread: SavedThread) {
  const keyPoints = thread.keyPoints.map((point) => `- ${point}`).join("\n");
  const tags = thread.tags.map((tag) => `#${tag}`).join(" ");

  return [
    thread.title,
    "",
    thread.summary,
    "",
    "주요 포인트",
    keyPoints,
    "",
    tags,
    thread.originalUrl ? `원문: ${thread.originalUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function AuthScreen({
  onAuthSuccess,
}: {
  onAuthSuccess: (response: { accessToken: string; user: ApiUser }) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("readnest@example.com");
  const [password, setPassword] = useState("ReadNest2026!");
  const [nickname, setNickname] = useState("ReadNest");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response =
        mode === "login"
          ? await readnestApi.login({ email, password })
          : await readnestApi.signup({ email, password, nickname });

      onAuthSuccess(response);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "인증에 실패했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.authRoot}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      <View style={styles.authCard}>
        <View style={styles.authBrandRow}>
          <Ionicons name="book-outline" size={28} color={colors.primary} />
          <Text style={styles.authBrand}>ReadNest</Text>
        </View>
        <Text style={styles.authTitle}>
          {mode === "login"
            ? "다시 읽을 지식을 모아두세요"
            : "ReadNest 시작하기"}
        </Text>
        <Text style={styles.authSubtitle}>
          Threads 링크를 저장하고 날짜별로 정리합니다.
        </Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="이메일"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.authInput}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="비밀번호"
          placeholderTextColor={colors.faint}
          secureTextEntry
          style={styles.authInput}
        />
        {mode === "signup" ? (
          <TextInput
            value={nickname}
            onChangeText={setNickname}
            placeholder="닉네임"
            placeholderTextColor={colors.faint}
            style={styles.authInput}
          />
        ) : null}

        {error ? <Text style={styles.authError}>{error}</Text> : null}

        <Pressable style={styles.primaryButton} onPress={submit}>
          <Text style={styles.primaryButtonText}>
            {isSubmitting
              ? "처리 중..."
              : mode === "login"
                ? "로그인"
                : "회원가입"}
          </Text>
        </Pressable>

        <Pressable
          style={styles.modeButton}
          onPress={() => {
            setMode((current) => (current === "login" ? "signup" : "login"));
            setError(null);
          }}
        >
          <Text style={styles.modeButtonText}>
            {mode === "login"
              ? "계정이 없나요? 회원가입"
              : "이미 계정이 있나요? 로그인"}
          </Text>
        </Pressable>

        <Text style={styles.apiHint}>API: {API_BASE_URL}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

type HomeProps = {
  url: string;
  onChangeUrl: (value: string) => void;
  onSave: () => void;
  isSaving: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  pendingSharedUrl: string | null;
  todayReadingThreads: SavedThread[];
  todayThreads: SavedThread[];
  summarizingThreads: SavedThread[];
  unreadThreads: SavedThread[];
  onShowUnread: () => void;
  onOpenThread: (thread: SavedThread) => void;
};

function HomeScreen({
  url,
  onChangeUrl,
  onSave,
  isSaving,
  isLoading,
  errorMessage,
  pendingSharedUrl,
  todayReadingThreads,
  todayThreads,
  summarizingThreads,
  unreadThreads,
  onShowUnread,
  onOpenThread,
}: HomeProps) {
  return (
    <View>
      <View style={styles.savePanel}>
        <View style={styles.saveHeader}>
          <Ionicons name="link-outline" size={20} color={colors.primary} />
          <Text style={styles.panelTitle}>Threads URL 저장</Text>
        </View>
        <TextInput
          value={url}
          onChangeText={onChangeUrl}
          placeholder="https://www.threads.net/..."
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.urlInput}
        />
        <Pressable style={styles.primaryButton} onPress={onSave}>
          <Text style={styles.primaryButtonText}>
            {isSaving ? "저장 중..." : "Save Thread"}
          </Text>
        </Pressable>
      </View>

      {errorMessage ? (
        <View style={styles.errorPanel}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Text style={styles.errorHint}>API 서버 주소: {API_BASE_URL}</Text>
        </View>
      ) : null}

      {pendingSharedUrl ? (
        <View style={styles.infoPanel}>
          <Text style={styles.infoText}>
            공유된 URL을 감지했습니다. Save Thread를 누르면 저장됩니다.
          </Text>
        </View>
      ) : null}

      {isLoading ? (
        <Text style={styles.loadingText}>저장글을 불러오는 중...</Text>
      ) : null}

      <Section
        title="오늘 읽을 글"
        count={todayReadingThreads.length}
        description={
          todayReadingThreads.length
            ? "저장해두고 아직 읽지 않은 글을 골랐어요"
            : "오늘은 밀린 글이 없어요"
        }
      >
        {todayReadingThreads.length ? (
          <>
            <Text style={styles.gentleHint}>
              오늘은 이 3개만 가볍게 읽어보세요.
            </Text>
            {todayReadingThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                onPress={onOpenThread}
              />
            ))}
            <Pressable style={styles.textButton} onPress={onShowUnread}>
              <Text style={styles.textButtonText}>안 읽은 글 전체 보기</Text>
            </Pressable>
          </>
        ) : (
          <EmptyText text="새로운 글을 저장하면 여기에서 추천해드릴게요." />
        )}
      </Section>

      <Section
        title="요약 중"
        count={summarizingThreads.length}
        description={
          summarizingThreads.length
            ? "요약이 끝나면 오늘 읽을 글에 추가돼요"
            : undefined
        }
      >
        {summarizingThreads.length ? (
          summarizingThreads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onPress={onOpenThread}
              compact
            />
          ))
        ) : (
          <EmptyText text="현재 요약 중인 Thread가 없습니다." />
        )}
      </Section>

      <Section title="오늘 저장한 글" count={todayThreads.length}>
        {todayThreads.length ? (
          todayThreads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onPress={onOpenThread}
            />
          ))
        ) : (
          <EmptyText text="오늘 저장한 Thread가 없습니다." />
        )}
      </Section>

      <Section title="안 읽음" count={unreadThreads.length}>
        {unreadThreads.length ? (
          unreadThreads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onPress={onOpenThread}
              compact
            />
          ))
        ) : (
          <EmptyText text="안 읽은 Thread가 없습니다." />
        )}
      </Section>
    </View>
  );
}

function ArchiveScreen({
  activeTab,
  onChangeTab,
  search,
  onChangeSearch,
  readFilter,
  onChangeReadFilter,
  threads,
  isLoading,
  onOpenThread,
}: {
  activeTab: string;
  onChangeTab: (tab: string) => void;
  search: string;
  onChangeSearch: (value: string) => void;
  readFilter: ArchiveReadFilter;
  onChangeReadFilter: (filter: ArchiveReadFilter) => void;
  threads: SavedThread[];
  isLoading: boolean;
  onOpenThread: (thread: SavedThread) => void;
}) {
  const readFilters: Array<{ label: string; value: ArchiveReadFilter }> = [
    { label: "전체", value: "ALL" },
    { label: "안 읽음", value: "UNREAD" },
    { label: "읽음", value: "READ" },
    { label: "다시 보기", value: "READ_LATER" },
  ];

  return (
    <View>
      <Text style={styles.screenTitle}>아카이브</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.faint} />
        <TextInput
          value={search}
          onChangeText={onChangeSearch}
          placeholder="저장된 Thread 검색"
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
        />
        <Ionicons name="options-outline" size={20} color={colors.muted} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroller}
      >
        <View style={styles.filterRow}>
          {readFilters.map((filter) => {
            const active = readFilter === filter.value;
            return (
              <Pressable
                key={filter.value}
                onPress={() => onChangeReadFilter(filter.value)}
                style={[styles.filterChip, active && styles.activeFilterChip]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.activeFilterChipText,
                  ]}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroller}
      >
        <View style={styles.tabs}>
          {archiveTabs.map((tab) => {
            const active = tab === activeTab;
            return (
              <Pressable
                key={tab}
                onPress={() => onChangeTab(tab)}
                style={[styles.tab, active && styles.activeTab]}
              >
                <Text style={[styles.tabText, active && styles.activeTabText]}>
                  {tab}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <DateHeader label="저장된 Thread" />
      {isLoading ? (
        <Text style={styles.loadingText}>아카이브를 불러오는 중...</Text>
      ) : null}
      {threads.length ? (
        threads.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            onPress={onOpenThread}
            compact
          />
        ))
      ) : (
        <EmptyText text="저장된 Thread가 없습니다." />
      )}
    </View>
  );
}

function ThreadDetail({
  thread,
  onBack,
  onToggleReadStatus,
  onMarkReadLater,
  onRetrySummary,
  onCopySummary,
  onShareSummary,
  onDelete,
}: {
  thread: SavedThread;
  onBack: () => void;
  onToggleReadStatus: (thread: SavedThread) => void;
  onMarkReadLater: (thread: SavedThread) => void;
  onRetrySummary: (thread: SavedThread) => void;
  onCopySummary: (thread: SavedThread) => void;
  onShareSummary: (thread: SavedThread) => void;
  onDelete: (thread: SavedThread) => void;
}) {
  const canRetry =
    thread.processStatus === "SUMMARY_FAILED" ||
    thread.processStatus === "CONTEXT_INSUFFICIENT";

  return (
    <View style={styles.detailRoot}>
      <View style={styles.detailHeader}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.inkSoft} />
        </Pressable>
        <Text style={styles.detailBrand}>ReadNest</Text>
        <View style={styles.detailHeaderSpacer} />
        <Pressable
          onPress={() => onDelete(thread)}
          style={styles.deleteIconButton}
        >
          <Ionicons name="trash-outline" size={20} color={colors.red} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.detailContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.metaLine}>
          <View style={styles.sourcePillLarge}>
            <Ionicons name="link-outline" size={14} color={colors.inkSoft} />
            <Text style={styles.sourceLargeText}>Threads</Text>
          </View>
          <Text style={styles.savedDate}>{thread.savedDateLabel} 저장</Text>
        </View>

        <Text style={styles.detailTitle}>{thread.title}</Text>

        {thread.summaryMeta ? (
          <View style={styles.summaryMetaRow}>
            <Text style={styles.summaryMetaBadge}>
              {thread.summaryMeta.summaryType}
            </Text>
            <Text style={styles.summaryMetaText}>
              맥락 {thread.summaryMeta.contextStatus}
            </Text>
            <Text style={styles.summaryMetaText}>
              신뢰도 {Math.round(thread.summaryMeta.confidence * 100)}%
            </Text>
          </View>
        ) : null}

        <View style={styles.detailTags}>
          {thread.tags.map((tag) => (
            <Text key={tag} style={styles.detailTag}>
              #{tag}
            </Text>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            style={styles.primaryPill}
            onPress={() => onToggleReadStatus(thread)}
          >
            <Text style={styles.primaryPillText}>
              {thread.readStatus === "READ" ? "안 읽음 표시" : "읽음 표시"}
            </Text>
          </Pressable>
          <Pressable
            style={styles.secondaryPill}
            onPress={() => onMarkReadLater(thread)}
          >
            <Text style={styles.secondaryPillText}>나중에 보기</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryPill}
            onPress={() => {
              if (thread.originalUrl) {
                void Linking.openURL(thread.originalUrl);
              }
            }}
          >
            <Text style={styles.secondaryPillText}>원본 링크 보기</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryPill}
            onPress={() => onCopySummary(thread)}
          >
            <Text style={styles.secondaryPillText}>요약 복사</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryPill}
            onPress={() => onShareSummary(thread)}
          >
            <Text style={styles.secondaryPillText}>공유</Text>
          </Pressable>
          {canRetry ? (
            <Pressable
              style={styles.retryPill}
              onPress={() => onRetrySummary(thread)}
            >
              <Ionicons
                name="refresh-outline"
                size={16}
                color={colors.primary}
              />
              <Text style={styles.retryPillText}>요약 재시도</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.dangerPill} onPress={() => onDelete(thread)}>
            <Ionicons name="trash-outline" size={16} color={colors.red} />
            <Text style={styles.dangerPillText}>삭제</Text>
          </Pressable>
        </View>

        {thread.threadPart ? (
          <View style={styles.infoNote}>
            <Ionicons
              name="git-network-outline"
              size={22}
              color={colors.primary}
            />
            <View style={styles.noteTextWrap}>
              <Text style={styles.noteTitle}>
                연결된 스레드 감지됨 Part {thread.threadPart.current} of{" "}
                {thread.threadPart.total}
              </Text>
              <Text style={styles.noteBody}>
                이 요약은 전체 시리즈의 일부를 기준으로 합니다.
              </Text>
            </View>
          </View>
        ) : null}

        {thread.processStatus === "CONTEXT_INSUFFICIENT" ? (
          <View style={styles.warningNote}>
            <Ionicons name="warning-outline" size={21} color={colors.amber} />
            <Text style={styles.warningText}>
              일부 내용이 누락되었을 수 있습니다. 나머지 파트도 저장하여 전체
              요약을 완성하세요.
            </Text>
          </View>
        ) : null}

        {thread.lastSummaryError ? (
          <View style={styles.warningNote}>
            <Ionicons
              name="alert-circle-outline"
              size={21}
              color={colors.red}
            />
            <Text style={styles.warningText}>{thread.lastSummaryError}</Text>
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <View style={styles.summaryBlock}>
            <View style={styles.summaryTitleRow}>
              <Ionicons
                name="sparkles-outline"
                size={20}
                color={colors.primary}
              />
              <Text style={styles.summaryTitle}>AI 요약</Text>
            </View>
            <Text style={styles.summaryText}>{thread.summary}</Text>
          </View>

          <View style={styles.divider} />

          <Text style={styles.keyPointTitle}>주요 포인트</Text>
          {thread.keyPoints.map((point) => (
            <View key={point} style={styles.keyPointRow}>
              <View style={styles.bullet} />
              <Text style={styles.keyPointText}>{point}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function SettingsScreen({
  user,
  onLogout,
}: {
  user: ApiUser;
  onLogout: () => void;
}) {
  return (
    <View>
      <Text style={styles.screenTitle}>설정</Text>
      <View style={styles.settingsCard}>
        <SettingRow label="계정" value={user.email} icon="person-outline" />
        <SettingRow
          label="닉네임"
          value={user.nickname}
          icon="id-card-outline"
        />
        <SettingRow label="요약 언어" value="한국어" icon="language-outline" />
        <SettingRow label="저장 대상" value="Threads only" icon="at-outline" />
      </View>
      <Pressable style={styles.logoutButton} onPress={onLogout}>
        <Text style={styles.logoutText}>로그아웃</Text>
      </Pressable>
    </View>
  );
}

function Section({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count: number;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      {description ? (
        <Text style={styles.sectionDescription}>{description}</Text>
      ) : null}
      {children}
    </View>
  );
}

function DateHeader({ label }: { label: string }) {
  return (
    <View style={styles.dateHeader}>
      <Text style={styles.dateHeaderText}>{label}</Text>
    </View>
  );
}

function EmptyText({ text }: { text: string }) {
  return <Text style={styles.emptyText}>{text}</Text>;
}

function SettingRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLeft}>
        <Ionicons name={icon} size={20} color={colors.primary} />
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  app: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 104,
  },
  authRoot: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.canvas,
  },
  authCard: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  authBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  authBrand: {
    color: colors.primary,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  authTitle: {
    color: colors.ink,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    marginBottom: spacing.sm,
  },
  authSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  authInput: {
    height: 48,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: colors.paper,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  authError: {
    color: colors.red,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
    fontWeight: "700",
  },
  modeButton: {
    marginTop: spacing.md,
    alignItems: "center",
  },
  modeButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  apiHint: {
    color: colors.faint,
    fontSize: 11,
    marginTop: spacing.lg,
    textAlign: "center",
  },
  savePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
    ...shadow.card,
  },
  saveHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  urlInput: {
    height: 48,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: colors.paper,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  primaryButton: {
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  errorPanel: {
    backgroundColor: colors.redSoft,
    borderColor: "#ffcdd2",
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: colors.red,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  errorHint: {
    color: colors.muted,
    fontSize: 11,
    marginTop: spacing.sm,
  },
  infoPanel: {
    backgroundColor: colors.blueSoft,
    borderColor: "#c7dcff",
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  infoText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  emptyText: {
    color: colors.faint,
    fontSize: 13,
    lineHeight: 20,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  sectionCount: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "800",
  },
  sectionDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  gentleHint: {
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  textButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  textButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  screenTitle: {
    color: colors.ink,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -1,
    marginBottom: spacing.lg,
  },
  searchBox: {
    height: 50,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
  },
  filterScroller: {
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.md,
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  filterChip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  activeFilterChip: {
    backgroundColor: colors.blueSoft,
    borderColor: "#c7dcff",
  },
  filterChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  activeFilterChipText: {
    color: colors.primary,
  },
  tabScroller: {
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.lg,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMid,
    borderRadius: radius.lg,
    padding: 4,
    marginHorizontal: spacing.lg,
    gap: 4,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  activeTab: {
    backgroundColor: colors.surface,
  },
  tabText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  activeTabText: {
    color: colors.primary,
  },
  dateHeader: {
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1,
    paddingBottom: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  dateHeaderText: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  detailRoot: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  detailHeader: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.paper,
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1,
    gap: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  detailBrand: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  detailHeaderSpacer: {
    flex: 1,
  },
  deleteIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.redSoft,
  },
  detailContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: "wrap",
  },
  sourcePillLarge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surfaceMid,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  sourceLargeText: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: "800",
  },
  savedDate: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  detailTitle: {
    color: colors.ink,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -1.2,
    marginBottom: spacing.md,
  },
  summaryMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  summaryMetaBadge: {
    overflow: "hidden",
    backgroundColor: colors.blueSoft,
    color: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 12,
    fontWeight: "800",
  },
  summaryMetaText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  detailTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  detailTag: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    flexWrap: "wrap",
  },
  primaryPill: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryPillText: {
    color: colors.surface,
    fontWeight: "800",
    fontSize: 13,
  },
  secondaryPill: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  secondaryPillText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 13,
  },
  dangerPill: {
    backgroundColor: colors.redSoft,
    borderColor: "#ffcdd2",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dangerPillText: {
    color: colors.red,
    fontWeight: "800",
    fontSize: 13,
  },
  retryPill: {
    backgroundColor: colors.blueSoft,
    borderColor: "#c7dcff",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  retryPillText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 13,
  },
  infoNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noteTextWrap: {
    flex: 1,
    gap: 4,
  },
  noteTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
  },
  noteBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  warningNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.amberSoft,
    borderColor: "#ffddb0",
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warningText: {
    flex: 1,
    color: "#773200",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  summaryBlock: {
    borderLeftColor: colors.primary,
    borderLeftWidth: 4,
    paddingLeft: spacing.md,
  },
  summaryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  summaryTitle: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: "800",
  },
  summaryText: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 25,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginVertical: spacing.lg,
  },
  keyPointTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.md,
  },
  keyPointRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  bullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 8,
  },
  keyPointText: {
    flex: 1,
    color: colors.inkSoft,
    fontSize: 15,
    lineHeight: 22,
  },
  settingsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  settingRow: {
    minHeight: 58,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1,
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  settingLabel: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  settingValue: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    maxWidth: "55%",
    textAlign: "right",
  },
  logoutButton: {
    height: 48,
    borderRadius: radius.md,
    borderColor: colors.hairline,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: {
    color: colors.red,
    fontSize: 14,
    fontWeight: "800",
  },
});
