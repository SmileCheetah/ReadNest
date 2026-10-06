const React = require("react");
const { act, create } = require("react-test-renderer");
const { AccessibilityInfo } = require("react-native");
const { KnowledgeHubScreen } = require("./KnowledgeHubScreen");
const { autoConnectionsApi } = require("../api/autoConnectionsApi");
const { readnestApi } = require("../api/readnestApi");

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("./KnowledgeScreen", () => ({ KnowledgeScreen: "ManualTopics" }));
jest.mock("../api/autoConnectionsApi", () => ({
  autoConnectionsApi: { list: jest.fn(), scan: jest.fn(), retry: jest.fn() },
}));
jest.mock("../api/readnestApi", () => ({
  readnestApi: { getArticle: jest.fn() },
}));

const now = "2026-10-07T00:00:00.000Z";
const articles = [
  {
    id: "a",
    title: "데이터 설계",
    savedAt: now,
    processStatus: "SUMMARY_DONE",
    scanState: "SUCCEEDED",
  },
  {
    id: "b",
    title: "금융 정합성",
    savedAt: now,
    processStatus: "SUMMARY_DONE",
    scanState: "SUCCEEDED",
  },
];
const connection = {
  id: "ab",
  leftArticleId: "a",
  rightArticleId: "b",
  relationType: "COMPLEMENT",
  reason: "데이터 설계의 원칙이 금융 정합성 문제로 이어진다.",
  leftEvidence: "데이터 구조를 먼저 결정한다.",
  rightEvidence: "금융 시스템은 정합성을 지켜야 한다.",
};
const output = (tree) => JSON.stringify(tree.toJSON());
let tree;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(true);
  autoConnectionsApi.list.mockResolvedValue({
    articles,
    connections: [connection],
  });
  autoConnectionsApi.scan.mockResolvedValue({ queued: 0, remaining: 0 });
  readnestApi.getArticle.mockResolvedValue({
    id: "b",
    title: "금융 정합성",
    source: "THREADS",
    url: "https://threads.com/@a/post/b",
    savedAt: now,
    readStatus: "UNREAD",
    processStatus: "SUMMARY_DONE",
    keyPoints: [],
    tags: [],
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it("starts automatic scanning and renders both source excerpts", async () => {
  await act(async () => {
    tree = create(
      React.createElement(KnowledgeHubScreen, {
        token: "token",
        onBack: jest.fn(),
        onOpenThread: jest.fn(),
      }),
    );
  });
  expect(autoConnectionsApi.scan).toHaveBeenCalledWith("token");
  expect(output(tree)).toContain(
    "데이터 설계의 원칙이 금융 정합성 문제로 이어진다.",
  );
  expect(output(tree)).toContain(connection.leftEvidence);
  expect(output(tree)).toContain(connection.rightEvidence);
  expect(output(tree)).toContain("내가 만든 주제 보기");
});

it("shows the empty state without asking the user to create a topic", async () => {
  autoConnectionsApi.list.mockResolvedValue({ articles: [], connections: [] });
  await act(async () => {
    tree = create(
      React.createElement(KnowledgeHubScreen, {
        token: "token",
        onBack: jest.fn(),
        onOpenThread: jest.fn(),
      }),
    );
  });
  expect(output(tree)).toContain("아직 저장한 글이 없어요");
  expect(output(tree)).not.toContain("새 주제 만들기");
});
