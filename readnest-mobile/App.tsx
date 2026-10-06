import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
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
import * as ExpoLinking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, ApiUser, readnestApi } from "./src/api/readnestApi";
import { guestIdentityStorage } from "./src/api/guestIdentityStorage";
import { tokenStorage } from "./src/api/tokenStorage";
import { guestModeEnabled } from "./src/config/authMode";
import { useArticleLibrary } from "./src/hooks/useArticleLibrary";
import { isProcessing } from "./src/hooks/articleState";
import { AppHeader } from "./src/components/AppHeader";
import { BottomNav } from "./src/components/BottomNav";
import { ThreadCard } from "./src/components/ThreadCard";
import { ThreadDetailScreen } from "./src/screens/ThreadDetailScreen";
import { KnowledgeScreen } from "./src/screens/KnowledgeScreen";
import { SavedThread } from "./src/data/mockThreads";
import { colors, radius, shadow, spacing } from "./src/theme/tokens";

export type ScreenName = "home" | "archive" | "settings";
type ArchiveReadFilter = "ALL" | "UNREAD" | "READ" | "READ_LATER";
type ArchivePeriod = "today" | "week" | "last-week" | "month" | "all";

const archiveTabs = ["전체 기간", "오늘", "이번 주", "지난주", "이번 달"];

function mapArchiveTabToPeriod(tab: string): ArchivePeriod {
  const periodByTab: Record<string, ArchivePeriod> = {
    오늘: "today",
    "이번 주": "week",
    지난주: "last-week",
    "이번 달": "month",
    "전체 기간": "all",
  };

  return periodByTab[tab] ?? "all";
}

export default function App() {
  const [screen, setScreen] = useState<ScreenName>("home");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [knowledgeRoute, setKnowledgeRoute] = useState<{
    ownerToken: string;
  } | null>(null);
  const [topicPickerRoute, setTopicPickerRoute] = useState<{
    ownerToken: string;
    article: SavedThread;
  } | null>(null);
  const [activeArchiveTab, setActiveArchiveTab] = useState("전체 기간");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveReadFilter, setArchiveReadFilter] =
    useState<ArchiveReadFilter>("ALL");
  const [url, setUrl] = useState("");
  const [pendingSharedUrl, setPendingSharedUrl] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isSavingArticle, setIsSavingArticle] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const authGeneration = useRef(0);
  const library = useArticleLibrary(
    accessToken,
    {
      period: mapArchiveTabToPeriod(activeArchiveTab),
      readStatus: archiveReadFilter === "ALL" ? undefined : archiveReadFilter,
      search: archiveSearch,
    },
    screen === "archive",
  );

  const restoreSession = useCallback(async () => {
    const generation = ++authGeneration.current;
    setIsRestoringSession(true);
    setSessionError(null);
    try {
      const storedToken = await tokenStorage.get();
      if (storedToken) {
        try {
          const me = await readnestApi.me(storedToken);
          if (generation !== authGeneration.current) return;
          setAccessToken(storedToken);
          setUser(me);
          return;
        } catch (error) {
          if (generation !== authGeneration.current) return;
          if (
            error instanceof ApiError &&
            (error.status === 401 || error.status === 403)
          ) {
            await tokenStorage.clear();
          } else {
            throw error;
          }
        }
      }

      if (!guestModeEnabled) return;
      const deviceId = await guestIdentityStorage.getOrCreate();
      const guestSession = await readnestApi.guest({ deviceId });
      if (generation !== authGeneration.current) return;
      await tokenStorage.set(guestSession.accessToken);
      setAccessToken(guestSession.accessToken);
      setUser(guestSession.user);
    } catch (error) {
      if (generation !== authGeneration.current) return;
      setSessionError(
        guestModeEnabled
          ? "게스트 세션을 준비하지 못했어요. API 서버 연결을 확인해 주세요."
          : "연결을 확인하지 못했어요. 로그인 정보는 안전하게 보관되어 있습니다.",
      );
    } finally {
      if (generation === authGeneration.current) setIsRestoringSession(false);
    }
  }, []);
  useEffect(() => {
    void restoreSession();
    return () => {
      ++authGeneration.current;
    };
  }, [restoreSession]);

  useEffect(() => {
    const handleIncomingUrl = (incomingUrl: string | null) => {
      if (!incomingUrl) return;
      const sharedUrl = ExpoLinking.parse(incomingUrl).queryParams?.url;
      if (typeof sharedUrl === "string") {
        setUrl(sharedUrl);
        setPendingSharedUrl(sharedUrl);
        setScreen("home");
      }
    };
    void ExpoLinking.getInitialURL().then(handleIncomingUrl);
    const subscription = ExpoLinking.addEventListener("url", (event) =>
      handleIncomingUrl(event.url),
    );
    return () => subscription.remove();
  }, []);

  const saveThreadUrl = async () => {
    if (!accessToken || saveInFlight.current) return;
    if (!url.trim()) {
      Alert.alert(
        "링크를 입력해 주세요",
        "Threads 게시물 링크를 붙여넣어 주세요.",
      );
      return;
    }
    saveInFlight.current = true;
    setIsSavingArticle(true);
    setSaveNotice(null);
    const generation = authGeneration.current;
    try {
      const article = await readnestApi.createArticle(accessToken, {
        url: url.trim(),
      });
      if (generation !== authGeneration.current) return;
      library.acceptCreated(article);
      setUrl("");
      setPendingSharedUrl(null);
      setSaveNotice("저장했어요. 요약이 준비되면 이 화면에 표시됩니다.");
    } catch (error) {
      if (generation === authGeneration.current)
        Alert.alert(
          "저장하지 못했어요",
          error instanceof Error
            ? error.message
            : "연결을 확인하고 다시 시도해 주세요.",
        );
    } finally {
      if (generation === authGeneration.current) {
        saveInFlight.current = false;
        setIsSavingArticle(false);
      }
    }
  };

  const changeRead = async (
    thread: SavedThread,
    status: SavedThread["readStatus"],
  ) => {
    try {
      await library.changeRead(thread, status);
    } catch {
      Alert.alert(
        "읽음 상태를 저장하지 못했어요",
        "연결을 확인하고 같은 상태로 다시 설정해 주세요.",
      );
    }
  };
  const retry = async (thread: SavedThread) => {
    try {
      await library.retry(thread);
    } catch (error) {
      Alert.alert(
        "요약 요청을 확인하지 못했어요",
        error instanceof Error
          ? error.message
          : "연결을 확인한 뒤 다시 시도해 주세요.",
      );
    }
  };
  const share = async (thread: SavedThread, markdown?: string) => {
    try {
      await Share.share({ message: formatThreadShareText(thread, markdown) });
    } catch {
      Alert.alert("공유하지 못했어요", "잠시 후 다시 시도해 주세요.");
    }
  };
  const remove = (thread: SavedThread) => {
    Alert.alert(
      "이 콘텐츠를 삭제할까요?",
      `“${thread.title}”을 삭제합니다.\n삭제한 콘텐츠는 목록에서 제거되며 복구할 수 없습니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => {
            void library
              .remove(thread)
              .catch(() =>
                Alert.alert(
                  "삭제하지 못했어요",
                  "연결을 확인하고 다시 시도해 주세요.",
                ),
              );
          },
        },
      ],
    );
  };
  const handleAuthSuccess = async (response: {
    accessToken: string;
    user: ApiUser;
  }) => {
    ++authGeneration.current;
    await tokenStorage.set(response.accessToken);
    setAccessToken(response.accessToken);
    setUser(response.user);
    setScreen("home");
    setSessionError(null);
  };
  const logout = async () => {
    ++authGeneration.current;
    saveInFlight.current = false;
    setIsSavingArticle(false);
    setAccessToken(null);
    setUser(null);
    setScreen("home");
    setArchiveSearch("");
    setSaveNotice(null);
    await tokenStorage.clear();
  };
  const selected = library.selectedThread;
  const knowledge =
    knowledgeRoute?.ownerToken === accessToken ? knowledgeRoute : null;
  const topicPicker =
    topicPickerRoute?.ownerToken === accessToken ? topicPickerRoute : null;
  const knowledgeVisible = !!knowledge && !selected && !topicPicker;
  useEffect(() => {
    setKnowledgeRoute(null);
    setTopicPickerRoute(null);
  }, [accessToken]);
  const showUnread = () => {
    setScreen("archive");
    setArchiveReadFilter("UNREAD");
    setActiveArchiveTab("전체 기간");
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        {isRestoringSession ? (
          <View style={styles.authRoot}>
            <Text style={styles.loadingText}>앱을 준비하는 중…</Text>
          </View>
        ) : sessionError ? (
          <View style={styles.authRoot}>
            <Text accessibilityRole="header" style={styles.authTitle}>
              잠시 연결이 끊겼어요
            </Text>
            <Text style={styles.authSubtitle}>{sessionError}</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.primaryButton}
              onPress={() => void restoreSession()}
            >
              <Text style={styles.primaryButtonText}>다시 연결</Text>
            </Pressable>
          </View>
        ) : !accessToken || !user ? (
          guestModeEnabled ? (
            <View style={styles.authRoot}>
              <Text accessibilityRole="header" style={styles.authTitle}>
                앱을 준비하지 못했어요
              </Text>
              <Pressable
                accessibilityRole="button"
                style={styles.primaryButton}
                onPress={() => void restoreSession()}
              >
                <Text style={styles.primaryButtonText}>다시 연결</Text>
              </Pressable>
            </View>
          ) : (
            <AuthScreen onAuthSuccess={handleAuthSuccess} />
          )
        ) : (
          <View style={styles.app}>
            <View
              style={[
                styles.app,
                (selected || knowledge) && styles.hiddenScreen,
              ]}
              accessibilityElementsHidden={!!selected || !!knowledge}
              importantForAccessibility={
                selected || knowledge ? "no-hide-descendants" : "auto"
              }
            >
              <AppHeader />
              {library.syncError ? (
                <View style={styles.syncNotice}>
                  <Text style={styles.syncNoticeText}>{library.syncError}</Text>
                </View>
              ) : null}
              {screen === "archive" ? (
                <ArchiveScreen
                  activeTab={activeArchiveTab}
                  onChangeTab={setActiveArchiveTab}
                  search={archiveSearch}
                  onChangeSearch={setArchiveSearch}
                  readFilter={archiveReadFilter}
                  onChangeReadFilter={setArchiveReadFilter}
                  threads={library.archiveThreads}
                  isLoading={library.archiveLoading}
                  loadingMore={library.loadingMore}
                  error={library.archiveError}
                  hasMore={!!library.nextCursor}
                  onRefresh={() => void library.refreshArchive()}
                  onLoadMore={() => void library.refreshArchive(true)}
                  onOpenThread={(thread) => void library.open(thread)}
                  onOpenKnowledge={() =>
                    setKnowledgeRoute({ ownerToken: accessToken })
                  }
                />
              ) : (
                <ScrollView
                  contentContainerStyle={styles.content}
                  keyboardShouldPersistTaps="handled"
                >
                  {screen === "home" ? (
                    <HomeScreen
                      url={url}
                      onChangeUrl={setUrl}
                      onSave={() => void saveThreadUrl()}
                      isSaving={isSavingArticle}
                      isLoading={library.homeLoading}
                      hasLoaded={library.homeHasLoaded}
                      errorMessage={library.homeError}
                      pendingSharedUrl={pendingSharedUrl}
                      threads={library.homeThreads}
                      saveNotice={saveNotice}
                      onRefresh={() => void library.refreshHome()}
                      onShowUnread={showUnread}
                      onOpenThread={(thread) => void library.open(thread)}
                    />
                  ) : (
                    <SettingsScreen
                      user={user}
                      guestMode={guestModeEnabled}
                      onLogout={() => void logout()}
                    />
                  )}
                </ScrollView>
              )}
              <BottomNav current={screen} onChange={setScreen} />
            </View>
            {knowledge ? (
              <View
                style={[styles.app, !knowledgeVisible && styles.hiddenScreen]}
                accessibilityElementsHidden={!knowledgeVisible}
                importantForAccessibility={
                  knowledgeVisible ? "auto" : "no-hide-descendants"
                }
              >
                <KnowledgeScreen
                  key={accessToken}
                  token={accessToken}
                  active={knowledgeVisible}
                  onBack={() => setKnowledgeRoute(null)}
                  onOpenThread={(thread) => void library.open(thread)}
                />
              </View>
            ) : null}
            {selected ? (
              <View
                style={[styles.app, !!topicPicker && styles.hiddenScreen]}
                accessibilityElementsHidden={!!topicPicker}
                importantForAccessibility={
                  topicPicker ? "no-hide-descendants" : "auto"
                }
              >
                <ThreadDetailScreen
                  key={selected.id}
                  thread={selected}
                  onBack={library.close}
                  active={!topicPicker}
                  onManageTopics={(thread) =>
                    setTopicPickerRoute({
                      ownerToken: accessToken,
                      article: thread,
                    })
                  }
                  onMarkReadOnOpen={(thread) =>
                    library.changeRead(thread, "READ", true)
                  }
                  onToggleReadStatus={(thread) =>
                    void changeRead(
                      thread,
                      thread.readStatus === "READ" ? "UNREAD" : "READ",
                    )
                  }
                  onMarkReadLater={(thread) =>
                    void changeRead(thread, "READ_LATER")
                  }
                  onRetrySummary={retry}
                  onRequestSummaryDensity={library.requestSummaryDensity}
                  onShareSummary={(thread, markdown) =>
                    void share(thread, markdown)
                  }
                  onDelete={remove}
                  loadingDetail={library.detailLoading}
                  detailError={library.detailError}
                  onRefresh={() => void library.fetchDetail(selected.id, true)}
                />
              </View>
            ) : null}
            {topicPicker ? (
              <KnowledgeScreen
                key={`${accessToken}:${topicPicker.article.id}`}
                token={accessToken}
                initialArticle={topicPicker.article}
                onBack={() => setTopicPickerRoute(null)}
                onOpenThread={(thread) => void library.open(thread)}
              />
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function formatThreadShareText(thread: SavedThread, markdown?: string) {
  return [
    markdown?.trim() ||
      thread.summaryMeta?.summaryMarkdown?.trim() ||
      "요약이 아직 없습니다.",
    thread.originalUrl ? `원문: ${thread.originalUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function AuthScreen({
  onAuthSuccess,
}: {
  onAuthSuccess: (response: {
    accessToken: string;
    user: ApiUser;
  }) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("Unwind");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response =
        mode === "login"
          ? await readnestApi.login({ email, password })
          : await readnestApi.signup({ email, password, nickname });

      await onAuthSuccess(response);
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
          <Image
            source={require("./assets/unwind-icon.png")}
            style={styles.authLogo}
          />
          <Text style={styles.authBrand}>Unwind</Text>
        </View>
        <Text style={styles.authTitle}>
          {mode === "login" ? "다시 읽을 지식을 모아두세요" : "Unwind 시작하기"}
        </Text>
        <Text style={styles.authSubtitle}>
          Threads 링크를 저장하고 날짜별로 정리합니다.
        </Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="이메일"
          accessibilityLabel="이메일"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.authInput}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="비밀번호"
          accessibilityLabel="비밀번호"
          placeholderTextColor={colors.faint}
          secureTextEntry
          style={styles.authInput}
        />
        {mode === "signup" ? (
          <TextInput
            value={nickname}
            onChangeText={setNickname}
            placeholder="닉네임"
            accessibilityLabel="닉네임"
            placeholderTextColor={colors.faint}
            style={styles.authInput}
          />
        ) : null}

        {error ? <Text style={styles.authError}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitting }}
          disabled={isSubmitting}
          style={styles.primaryButton}
          onPress={() => void submit()}
        >
          <Text style={styles.primaryButtonText}>
            {isSubmitting
              ? "처리 중..."
              : mode === "login"
                ? "로그인"
                : "회원가입"}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
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
  hasLoaded: boolean;
  errorMessage: string | null;
  pendingSharedUrl: string | null;
  threads: SavedThread[];
  saveNotice: string | null;
  onRefresh: () => void;
  onShowUnread: () => void;
  onOpenThread: (thread: SavedThread) => void;
};

function Feedback({
  text,
  action,
  onAction,
}: {
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.feedback}>
      <Text style={styles.feedbackText} accessibilityLiveRegion="polite">
        {text}
      </Text>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          style={styles.textButton}
          onPress={onAction}
        >
          <Text style={styles.textButtonText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function HomeScreen({
  url,
  onChangeUrl,
  onSave,
  isSaving,
  isLoading,
  hasLoaded,
  errorMessage,
  pendingSharedUrl,
  threads,
  saveNotice,
  onRefresh,
  onShowUnread,
  onOpenThread,
}: HomeProps) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const initialCaptureDecision = useRef(false);
  useEffect(() => {
    if (hasLoaded && !initialCaptureDecision.current) {
      initialCaptureDecision.current = true;
      if (!threads.length) setCaptureOpen(true);
    }
  }, [hasLoaded, threads.length]);
  useEffect(() => {
    if (pendingSharedUrl) setCaptureOpen(true);
  }, [pendingSharedUrl]);
  const captureVisible = captureOpen;
  const processing = threads.filter(isProcessing);
  const failed = threads.filter(
    (thread) => thread.processStatus === "SUMMARY_FAILED",
  );
  const readable = threads.filter(
    (thread) =>
      !isProcessing(thread) && thread.processStatus !== "SUMMARY_FAILED",
  );
  const reading = readable
    .filter((thread) => thread.readStatus !== "READ")
    .sort(
      (a, b) =>
        Number(a.readStatus !== "READ_LATER") -
        Number(b.readStatus !== "READ_LATER"),
    )
    .slice(0, 6);
  const readingIds = new Set(reading.map((thread) => thread.id));
  const recent = readable
    .filter((thread) => !readingIds.has(thread.id))
    .slice(0, 6);
  return (
    <View>
      <View style={styles.homeHeading}>
        <View style={styles.flexContent}>
          <Text accessibilityRole="header" style={styles.screenTitle}>
            다시 꺼내 읽는 생각
          </Text>
          <Text style={styles.homeDescription}>
            저장한 글의 핵심부터 가볍게 살펴보세요.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            captureVisible ? "링크 저장 입력 닫기" : "링크 저장"
          }
          accessibilityState={{ expanded: captureVisible }}
          style={styles.captureToggle}
          onPress={() => {
            initialCaptureDecision.current = true;
            setCaptureOpen((value) => !value);
          }}
        >
          <Ionicons
            name={captureVisible ? "close-outline" : "add-outline"}
            size={22}
            color={colors.primary}
          />
          <Text style={styles.textButtonText}>링크</Text>
        </Pressable>
      </View>
      {captureVisible ? (
        <View style={styles.savePanel}>
          <Text style={styles.panelTitle}>Threads 링크 저장</Text>
          <Text style={styles.inputLabel}>게시물 링크</Text>
          <TextInput
            value={url}
            onChangeText={onChangeUrl}
            placeholder="https://www.threads.com/@..."
            placeholderTextColor={colors.muted}
            accessibilityLabel="Threads 게시물 링크"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.urlInput}
          />
          {pendingSharedUrl ? (
            <Text style={styles.sectionDescription}>
              공유한 링크를 확인했어요. 저장을 눌러주세요.
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSaving }}
            disabled={isSaving}
            style={[styles.primaryButton, isSaving && styles.disabledControl]}
            onPress={onSave}
          >
            <Text style={styles.primaryButtonText}>
              {isSaving ? "저장 중…" : "링크 저장"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {saveNotice ? (
        <Text accessibilityLiveRegion="polite" style={styles.saveNotice}>
          {saveNotice}
        </Text>
      ) : null}
      {errorMessage ? (
        <Feedback
          text={errorMessage}
          action="다시 불러오기"
          onAction={onRefresh}
        />
      ) : null}
      {(!hasLoaded || isLoading) && !errorMessage && !threads.length ? (
        <View
          accessibilityLabel="저장글 불러오는 중"
          style={styles.skeletonGroup}
        >
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonLine} />
          <View style={styles.skeletonLine} />
          <Text style={styles.loadingText}>저장글을 불러오는 중…</Text>
        </View>
      ) : null}
      {reading.length ? (
        <Section
          title="다시 볼 글"
          count={reading.length}
          description="다시 보기로 표시한 글과 아직 읽지 않은 글이에요."
        >
          {reading.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onPress={onOpenThread}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            style={styles.textButton}
            onPress={onShowUnread}
          >
            <Text style={styles.textButtonText}>안 읽은 글 전체 보기</Text>
          </Pressable>
        </Section>
      ) : null}
      {processing.length ? (
        <View style={styles.processingSection}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            요약 중 {processing.length}개
          </Text>
          <Text style={styles.sectionDescription}>
            준비가 끝나면 자동으로 업데이트됩니다.
          </Text>
          {processing.map((thread) => (
            <Pressable
              key={thread.id}
              accessibilityRole="button"
              accessibilityLabel={thread.title + ", 요약 상태 보기"}
              style={styles.processingRow}
              onPress={() => onOpenThread(thread)}
            >
              <Ionicons name="time-outline" size={18} color={colors.primary} />
              <Text numberOfLines={2} style={styles.processingTitle}>
                {thread.title}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {failed.length ? (
        <Section
          title="확인이 필요한 글"
          count={failed.length}
          description="글을 열어 원인을 확인하고 다시 시도할 수 있어요."
        >
          {failed.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onPress={onOpenThread}
            />
          ))}
        </Section>
      ) : null}
      {recent.length ? (
        <Section title="최근 저장한 글" count={recent.length}>
          {recent.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onPress={onOpenThread}
            />
          ))}
        </Section>
      ) : null}
      {hasLoaded && !isLoading && !errorMessage && !threads.length ? (
        <Feedback text="처음 저장한 글이 여기에 모입니다. 읽다가 다시 떠올리고 싶은 글의 링크를 저장해 보세요." />
      ) : null}
      {!isLoading &&
      threads.length > 0 &&
      !reading.length &&
      !recent.length &&
      !processing.length &&
      !failed.length ? (
        <Feedback
          text="새로 저장한 글을 확인하고 있어요."
          action="새로고침"
          onAction={onRefresh}
        />
      ) : null}
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
  loadingMore,
  error,
  hasMore,
  onRefresh,
  onLoadMore,
  onOpenThread,
  onOpenKnowledge,
}: {
  activeTab: string;
  onChangeTab: (tab: string) => void;
  search: string;
  onChangeSearch: (value: string) => void;
  readFilter: ArchiveReadFilter;
  onChangeReadFilter: (filter: ArchiveReadFilter) => void;
  threads: SavedThread[];
  isLoading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenThread: (thread: SavedThread) => void;
  onOpenKnowledge: () => void;
}) {
  const filters: Array<{ label: string; value: ArchiveReadFilter }> = [
    { label: "전체", value: "ALL" },
    { label: "안 읽음", value: "UNREAD" },
    { label: "읽음", value: "READ" },
    { label: "다시 보기", value: "READ_LATER" },
  ];
  const filtered =
    !!search.trim() || readFilter !== "ALL" || activeTab !== "전체 기간";
  return (
    <FlatList
      data={threads}
      keyExtractor={(thread) => thread.id}
      renderItem={({ item }) => (
        <ThreadCard thread={item} onPress={onOpenThread} />
      )}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshing={isLoading && !!threads.length}
      onRefresh={onRefresh}
      onEndReached={() => {
        if (hasMore && !loadingMore && !isLoading && !error) onLoadMore();
      }}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={
        <View>
          <Text accessibilityRole="header" style={styles.screenTitle}>
            보관함
          </Text>
          <Text style={styles.homeDescription}>
            저장한 생각을 다시 찾아보세요.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="주제로 모아보기"
            style={styles.topicEntry}
            onPress={onOpenKnowledge}
          >
            <Ionicons
              name="folder-open-outline"
              size={20}
              color={colors.primaryPressed}
            />
            <Text style={styles.textButtonText}>주제로 모아보기</Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.primaryPressed}
            />
          </Pressable>
          <Text style={styles.inputLabel}>저장글 검색</Text>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={onChangeSearch}
              placeholder="제목이나 내용 검색"
              accessibilityLabel="저장글 제목이나 내용 검색"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
            />
            {search ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="검색어 지우기"
                onPress={() => onChangeSearch("")}
                style={styles.clearSearch}
              >
                <Ionicons name="close-outline" size={20} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroller}
          >
            <View style={styles.filterRow}>
              {filters.map((filter) => (
                <Pressable
                  key={filter.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: readFilter === filter.value }}
                  style={[
                    styles.filterChip,
                    readFilter === filter.value && styles.activeFilterChip,
                  ]}
                  onPress={() => onChangeReadFilter(filter.value)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      readFilter === filter.value &&
                        styles.activeFilterChipText,
                    ]}
                  >
                    {filter.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Text style={styles.inputLabel}>저장 기간</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabScroller}
          >
            <View style={styles.filterRow}>
              {archiveTabs.map((tab) => (
                <Pressable
                  key={tab}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activeTab === tab }}
                  style={[
                    styles.periodButton,
                    activeTab === tab && styles.activePeriodButton,
                  ]}
                  onPress={() => onChangeTab(tab)}
                >
                  <Text
                    style={[
                      styles.tabText,
                      activeTab === tab && styles.activeTabText,
                    ]}
                  >
                    {tab}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          {error ? (
            <Feedback
              text={error}
              action={threads.length && hasMore ? "다시 시도" : "다시 불러오기"}
              onAction={threads.length && hasMore ? onLoadMore : onRefresh}
            />
          ) : null}
          {isLoading && !threads.length ? (
            <View
              accessibilityLabel="보관함 불러오는 중"
              style={styles.skeletonGroup}
            >
              <View style={styles.skeletonTitle} />
              <View style={styles.skeletonLine} />
              <View style={styles.skeletonLine} />
              <Text style={styles.loadingText}>보관함을 불러오는 중…</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !isLoading && !error ? (
          <Feedback
            text={
              filtered
                ? "조건에 맞는 글이 없어요. 검색어나 필터를 바꿔보세요."
                : "아직 저장한 글이 없어요. 홈에서 링크를 저장해 보세요."
            }
          />
        ) : null
      }
      ListFooterComponent={
        loadingMore ? (
          <Text style={styles.loadingText}>더 불러오는 중…</Text>
        ) : hasMore && !error ? (
          <Pressable
            accessibilityRole="button"
            style={styles.moreButton}
            onPress={onLoadMore}
          >
            <Text style={styles.textButtonText}>더 불러오기</Text>
          </Pressable>
        ) : threads.length ? (
          <Text style={styles.endOfList}>저장글을 모두 확인했어요.</Text>
        ) : null
      }
    />
  );
}
function SettingsScreen({
  user,
  guestMode,
  onLogout,
}: {
  user: ApiUser;
  guestMode: boolean;
  onLogout: () => void;
}) {
  return (
    <View>
      <Text accessibilityRole="header" style={styles.screenTitle}>
        설정
      </Text>
      <View style={styles.settingsCard}>
        <SettingRow
          label="계정"
          value={guestMode ? "이 기기 전용 게스트" : user.email}
          icon="person-outline"
        />
        <SettingRow
          label="닉네임"
          value={user.nickname}
          icon="id-card-outline"
        />
        <SettingRow label="요약 언어" value="한국어" icon="language-outline" />
        <SettingRow label="저장 대상" value="Threads only" icon="at-outline" />
      </View>
      {guestMode ? (
        <Text style={styles.guestNotice}>
          개발용 게스트 데이터는 이 기기에 연결됩니다. 앱을 삭제하면 다시
          접근하지 못할 수 있어요.
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          style={styles.logoutButton}
          onPress={onLogout}
        >
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
      )}
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
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      {description ? (
        <Text style={styles.sectionDescription}>{description}</Text>
      ) : null}
      {children}
    </View>
  );
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
  hiddenScreen: { display: "none" },
  topicEntry: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.blueSoft,
  },
  flexContent: { flex: 1 },
  homeHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  homeDescription: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  captureToggle: {
    minHeight: 48,
    minWidth: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.blueSoft,
    paddingHorizontal: spacing.sm,
  },
  inputLabel: {
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  disabledControl: { opacity: 0.65 },
  saveNotice: {
    color: colors.inkSoft,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  feedback: {
    backgroundColor: colors.surfaceLow,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  feedbackText: { color: colors.inkSoft, fontSize: 15, lineHeight: 24 },
  syncNotice: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.amberSoft,
  },
  syncNoticeText: { color: colors.amber, fontSize: 13, lineHeight: 20 },
  skeletonGroup: { gap: spacing.sm, marginBottom: spacing.lg },
  skeletonTitle: {
    width: "62%",
    height: 24,
    backgroundColor: colors.surfaceMid,
    borderRadius: radius.sm,
  },
  skeletonLine: {
    height: 16,
    backgroundColor: colors.surfaceMid,
    borderRadius: radius.sm,
  },
  processingSection: { marginBottom: spacing.lg },
  processingRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  processingTitle: {
    flex: 1,
    color: colors.inkSoft,
    fontSize: 15,
    lineHeight: 23,
  },
  clearSearch: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  periodButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  activePeriodButton: { borderBottomColor: colors.primary },
  moreButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.md,
  },
  endOfList: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    padding: spacing.md,
  },
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
    paddingBottom: spacing.xl,
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
  authLogo: {
    width: 32,
    height: 32,
    borderRadius: 9,
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
    minHeight: 48,
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
    minHeight: 44,
    justifyContent: "center",
    marginTop: spacing.md,
    alignItems: "center",
  },
  modeButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  savePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  urlInput: {
    minHeight: 48,
    paddingVertical: spacing.sm,
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
    minHeight: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: spacing.md,
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
  textButton: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  textButtonText: {
    color: colors.primaryPressed,
    fontSize: 13,
    fontWeight: "800",
  },
  screenTitle: {
    color: colors.ink,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
  },
  searchBox: {
    minHeight: 48,
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
    minHeight: 44,
    justifyContent: "center",
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
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
    fontSize: 14,
    fontWeight: "800",
  },
  activeFilterChipText: {
    color: colors.primaryPressed,
  },
  tabScroller: {
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.lg,
  },
  tabText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  activeTabText: {
    color: colors.primaryPressed,
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
  guestNotice: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
});
