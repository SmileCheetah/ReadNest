const React = require("react");
const { act, create } = require("react-test-renderer");
const { AccessibilityInfo, Alert, Text } = require("react-native");
const Clipboard = require("expo-clipboard");
const { ThreadDetailScreen } = require("../../screens/ThreadDetailScreen");
const { MarkdownSummary } = require("./MarkdownSummary");

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

const markdown =
  "# 문서 제목\n\n**핵심 주장**을 설명합니다.\n\n### 근거\n\n이유를 설명합니다.";
const article = {
  id: "article-one",
  title: "목록 제목",
  summary: "",
  keyPoints: [],
  tags: [],
  summaryMeta: {
    summaryMarkdown: markdown,
    contextStatus: "완결",
    caution: "",
  },
  originalUrl: "https://www.threads.com/@example/post/one",
  rawText: "원문",
  source: "Threads",
  savedDateLabel: "오늘",
  savedAt: "2026-09-29",
  processStatus: "SUMMARY_DONE",
  readStatus: "UNREAD",
};

function props(thread = article) {
  return {
    thread,
    onBack: jest.fn(),
    onMarkReadOnOpen: jest.fn(),
    onToggleReadStatus: jest.fn(),
    onMarkReadLater: jest.fn(),
    onRetrySummary: jest.fn(),
    onShareSummary: jest.fn(),
    onDelete: jest.fn(),
  };
}
const textNodes = (node) =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(textNodes).join(" ")
      : node?.children
        ? textNodes(node.children)
        : "";
const text = (tree) => textNodes(tree.toJSON());
const button = (tree, label) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )[0];
let trees;
async function render(component) {
  let tree;
  await act(async () => {
    tree = create(component);
  });
  trees.push(tree);
  return tree;
}

beforeEach(() => {
  trees = [];
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => {});
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  Clipboard.setStringAsync.mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => {
    trees.forEach((tree) => tree.unmount());
  });
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it("renders one title, introduction, actions and body inside one AI summary surface", async () => {
  const tree = await render(React.createElement(ThreadDetailScreen, props()));
  const output = text(tree);
  expect(output).toContain("문서 제목");
  expect(output).not.toContain("목록 제목");
  expect(output).not.toContain("핵심 한 줄 요약");
  expect(output).not.toContain("분석 정보");
  expect(output).not.toContain("완결");
  expect(output.match(/AI 요약/g)).toHaveLength(1);
  expect(output.indexOf("원문 보기")).toBeLessThan(
    output.indexOf("이유를 설명합니다."),
  );
});

it("falls back to the saved title once when Markdown has no document heading", async () => {
  const tree = await render(
    React.createElement(
      ThreadDetailScreen,
      props({
        ...article,
        summaryMeta: {
          ...article.summaryMeta,
          summaryMarkdown: "핵심 주장입니다.\n\n### 근거\n\n이유를 설명합니다.",
        },
      }),
    ),
  );
  expect(text(tree).match(/목록 제목/g)).toHaveLength(1);
});

it("marks read only after a valid document is displayed and only once per entry", async () => {
  const callbacks = props({
    ...article,
    processStatus: "SUMMARIZING",
    summaryMeta: undefined,
  });
  const tree = await render(React.createElement(ThreadDetailScreen, callbacks));
  expect(callbacks.onMarkReadOnOpen).not.toHaveBeenCalled();
  await act(async () => {
    tree.update(
      React.createElement(ThreadDetailScreen, {
        ...callbacks,
        thread: article,
      }),
    );
  });
  expect(callbacks.onMarkReadOnOpen).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.update(
      React.createElement(ThreadDetailScreen, {
        ...callbacks,
        thread: { ...article, readStatus: "READ" },
      }),
    );
  });
  await act(async () => {
    tree.update(
      React.createElement(ThreadDetailScreen, {
        ...callbacks,
        thread: { ...article, readStatus: "UNREAD" },
      }),
    );
  });
  expect(callbacks.onMarkReadOnOpen).toHaveBeenCalledTimes(1);
});

it("keeps last successful Markdown visible during regeneration and after a failed attempt", async () => {
  const callbacks = props({ ...article, processStatus: "SUMMARIZING" });
  const tree = await render(React.createElement(ThreadDetailScreen, callbacks));
  expect(text(tree)).toContain("새 요약을 만들고 있어요");
  expect(text(tree)).toContain("이유를 설명합니다.");
  await act(async () => {
    tree.update(
      React.createElement(ThreadDetailScreen, {
        ...callbacks,
        thread: { ...article, processStatus: "SUMMARY_FAILED" },
      }),
    );
  });
  expect(text(tree)).toContain("요약을 갱신하지 못했어요");
  expect(text(tree)).toContain("이유를 설명합니다.");
});

it("shows detail loading rather than claiming a summary is missing", async () => {
  const tree = await render(
    React.createElement(ThreadDetailScreen, {
      ...props({ ...article, summaryMeta: undefined }),
      loadingDetail: true,
    }),
  );
  expect(text(tree)).toContain("저장한 글을 불러오는 중이에요.");
  expect(text(tree)).not.toContain("아직 요약이 없어요");
});

it("shows partial-source warnings before the document and hides unverified analysis claims", async () => {
  const tree = await render(
    React.createElement(
      ThreadDetailScreen,
      props({ ...article, sourceCompleteness: "PARTIAL" }),
    ),
  );
  expect(text(tree).indexOf("일부 원문으로 만든 요약이에요")).toBeLessThan(
    text(tree).indexOf("문서 제목"),
  );
  expect(text(tree)).not.toContain("완결");
});

it("does not present server diagnostics as user-facing failure text", async () => {
  const tree = await render(
    React.createElement(
      ThreadDetailScreen,
      props({
        ...article,
        summaryMeta: undefined,
        processStatus: "SUMMARY_FAILED",
        errorCode: "PERSISTENCE_FAILED",
        lastSummaryError: "SQL internal-host private-query",
        retryAfterSeconds: 2,
      }),
    ),
  );
  expect(text(tree)).toContain("요약 결과를 저장하지 못했어요");
  expect(text(tree)).not.toContain("SQL internal-host");
  expect(button(tree, "요약 다시 생성").props.disabled).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(button(tree, "요약 다시 생성").props.disabled).toBe(false);
});

it("exposes explicit regeneration for completed documents and blocks repeated taps", async () => {
  let finish;
  const callbacks = props();
  callbacks.onRetrySummary.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const tree = await render(React.createElement(ThreadDetailScreen, callbacks));
  await act(async () => {
    button(tree, "더보기").props.onPress();
  });
  const action = button(tree, "요약 다시 생성").props.onPress;
  await act(async () => {
    action();
    action();
  });
  expect(callbacks.onRetrySummary).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
  });
});

it("copies the entire Markdown plus source URL, announces success and resets after two seconds", async () => {
  const tree = await render(React.createElement(ThreadDetailScreen, props()));
  await act(async () => {
    await button(tree, "요약 복사").props.onPress();
  });
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
    `${markdown}\n\n원문: ${article.originalUrl}`,
  );
  expect(text(tree)).toContain("✓ 복사됨");
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
    "요약과 원문 링크를 복사했습니다.",
  );
  await act(async () => {
    jest.advanceTimersByTime(1999);
  });
  expect(text(tree)).toContain("✓ 복사됨");
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(text(tree)).not.toContain("✓ 복사됨");
});

it("offers a recoverable copy error and allows a successful retry", async () => {
  Clipboard.setStringAsync.mockRejectedValueOnce(
    new Error("clipboard unavailable"),
  );
  const tree = await render(React.createElement(ThreadDetailScreen, props()));
  await act(async () => {
    await button(tree, "요약 복사").props.onPress();
  });
  expect(text(tree)).toContain("다시 복사");
  expect(Alert.alert).toHaveBeenCalledWith(
    "복사하지 못했어요",
    expect.any(String),
  );
  await act(async () => {
    await button(tree, "요약 복사").props.onPress();
  });
  expect(text(tree)).toContain("✓ 복사됨");
});

it("reveals every intermediate block on expansion instead of jumping to a short conclusion", async () => {
  const longMarkdown = `# 제목\n\n도입\n\n### 긴 근거\n\n${"설명".repeat(2100)}\n\n끝 결론`;
  const tree = await render(
    React.createElement(MarkdownSummary, { markdown: longMarkdown }),
  );
  expect(text(tree)).not.toContain("끝 결론");
  expect(text(tree)).not.toContain("긴 근거");
  await act(async () => {
    button(tree, "전체 요약 펼치기").props.onPress();
  });
  expect(text(tree)).toContain("긴 근거");
  expect(text(tree)).toContain("끝 결론");
  expect(button(tree, "전체 요약 접기").props.accessibilityState.expanded).toBe(
    true,
  );
});

it("makes each numbered item independently readable, with original marker and no Markdown symbols", async () => {
  const tree = await render(
    React.createElement(MarkdownSummary, {
      markdown: "10. **데이터**를 확인\n11. 결과 검토",
    }),
  );
  const numberedLabels = tree.root
    .findAllByType(Text)
    .map((node) => node.props.accessibilityLabel)
    .filter(Boolean);
  expect(numberedLabels).toEqual(["10. 데이터를 확인", "11. 결과 검토"]);
});
