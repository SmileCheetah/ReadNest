const React = require("react");
const { act, create } = require("react-test-renderer");
const { TextInput } = require("react-native");
const { KnowledgeScreen } = require("./KnowledgeScreen");
const { knowledgeApi } = require("../api/knowledgeApi");
const { readnestApi, ApiError } = require("../api/readnestApi");

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));
jest.mock("../api/knowledgeApi");
jest.mock("../api/readnestApi", () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  },
  readnestApi: {
    listArticlePage: jest.fn(),
    getArticle: jest.fn(),
    updateReadStatus: jest.fn(),
  },
}));
const topic = {
  id: "t1",
  name: "AI 업무 활용",
  description: "저장한 지식을 다시 활용하기",
  revision: 1,
  articleCount: 1,
  createdAt: "2026-10-07",
  updatedAt: "2026-10-07",
};
const topic2 = { ...topic, id: "t2", name: "개발 기본기" };
const article = {
  id: "a1",
  source: "THREADS",
  url: "https://threads.com/@one/post/a1",
  title: "저장한 첫 글",
  summaryPreview: "핵심 내용",
  savedAt: "2026-10-07",
  processStatus: "SUMMARY_DONE",
  readStatus: "UNREAD",
  keyPoints: [],
  tags: [],
};
const savedThread = { id: "a1", title: "저장한 첫 글" };
const nodesText = (node) =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(nodesText).join(" ")
      : node?.children
        ? nodesText(node.children)
        : "";
const text = (tree) => nodesText(tree.toJSON());
const button = (tree, label) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )[0];
const input = (tree, label) =>
  tree.root
    .findAllByType(TextInput)
    .find((node) => node.props.accessibilityLabel === label);
async function press(tree, label) {
  await act(async () => button(tree, label).props.onPress());
}
async function type(tree, label, value) {
  await act(async () => input(tree, label).props.onChangeText(value));
}
let tree;
let props;
async function render(extra = {}) {
  props = {
    token: "token-a",
    onBack: jest.fn(),
    onOpenThread: jest.fn(),
    ...extra,
  };
  await act(async () => {
    tree = create(React.createElement(KnowledgeScreen, props));
  });
  return tree;
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest.resetAllMocks();
  knowledgeApi.listTopics.mockResolvedValue({
    items: [topic, topic2],
    nextCursor: null,
  });
  knowledgeApi.listArticles.mockResolvedValue({
    items: [article],
    nextCursor: null,
  });
  knowledgeApi.articleTopics.mockResolvedValue({ items: [], nextCursor: null });
  knowledgeApi.getTopic.mockResolvedValue(topic);
  knowledgeApi.createTopic.mockResolvedValue({
    ...topic,
    id: "created",
    name: "새 주제",
    articleCount: 0,
  });
  knowledgeApi.updateTopic.mockResolvedValue({
    ...topic,
    name: "고친 이름",
    revision: 2,
  });
  knowledgeApi.linkArticle.mockResolvedValue({
    ...topic,
    revision: 2,
    articleCount: 2,
  });
  knowledgeApi.unlinkArticle.mockResolvedValue({
    ...topic,
    revision: 2,
    articleCount: 0,
  });
  knowledgeApi.deleteTopic.mockResolvedValue({ deleted: true, id: topic.id });
  readnestApi.listArticlePage.mockResolvedValue({
    items: [article],
    nextCursor: null,
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.useRealTimers();
});

it("shows topic organization and only opens article on explicit reading action", async () => {
  await render();
  expect(text(tree)).toContain("주제로 모아보기");
  await press(tree, "AI 업무 활용, 글 1개");
  expect(text(tree)).toContain("저장한 첫 글");
  expect(props.onOpenThread).not.toHaveBeenCalled();
  await press(tree, "저장한 첫 글 읽기");
  expect(props.onOpenThread).toHaveBeenCalledWith(
    expect.objectContaining({ id: "a1" }),
  );
  expect(readnestApi.updateReadStatus).not.toHaveBeenCalled();
});
it("keeps failed create input and prevents leaving a dirty editor silently", async () => {
  await render();
  await press(tree, "새 주제 만들기");
  await type(tree, "주제 이름", "내가 만든 이름");
  knowledgeApi.createTopic.mockRejectedValueOnce(
    new Error("이미 같은 이름이 있어요"),
  );
  await press(tree, "주제 저장");
  expect(input(tree, "주제 이름").props.value).toBe("내가 만든 이름");
  expect(text(tree)).toContain("이미 같은 이름이 있어요");
  await press(tree, "뒤로");
  expect(text(tree)).toContain("저장하지 않고 나갈까요");
  await press(tree, "계속 작성하기");
  expect(input(tree, "주제 이름").props.value).toBe("내가 만든 이름");
});
it("preserves local text on 409, lets user inspect latest content, then retries with latest revision", async () => {
  await render();
  await press(tree, "AI 업무 활용, 글 1개");
  await press(tree, "주제 편집");
  await type(tree, "주제 이름", "내 수정");
  knowledgeApi.updateTopic.mockRejectedValueOnce(
    new ApiError("다른 변경이 있습니다", 409),
  );
  await press(tree, "주제 저장");
  expect(input(tree, "주제 이름").props.value).toBe("내 수정");
  expect(button(tree, "주제 저장").props.disabled).toBe(true);
  knowledgeApi.getTopic.mockResolvedValueOnce({
    ...topic,
    name: "다른 기기의 이름",
    revision: 8,
  });
  await press(tree, "최신 정보 확인");
  expect(input(tree, "주제 이름").props.value).toBe("내 수정");
  expect(text(tree)).toContain("다른 기기의 이름");
  await press(tree, "주제 저장");
  expect(knowledgeApi.updateTopic).toHaveBeenLastCalledWith(
    "token-a",
    "t1",
    expect.objectContaining({ name: "내 수정", expectedRevision: 8 }),
  );
});
it("requires inline topic deletion confirmation and preserves saved articles", async () => {
  await render();
  await press(tree, "AI 업무 활용, 글 1개");
  await press(tree, "주제 삭제");
  expect(knowledgeApi.deleteTopic).not.toHaveBeenCalled();
  expect(text(tree)).toContain("저장글과 요약은 보관함에 그대로 남습니다");
  await press(tree, "주제 삭제 확인");
  expect(knowledgeApi.deleteTopic).toHaveBeenCalledWith("token-a", "t1");
  expect(text(tree)).toContain("주제만 삭제했어요");
});
it("preserves article selections across search and pages, does not mark picker articles read", async () => {
  readnestApi.listArticlePage.mockResolvedValueOnce({
    items: [article],
    nextCursor: "next",
  });
  await render();
  await press(tree, "AI 업무 활용, 글 1개");
  await press(tree, "저장글 연결");
  await press(tree, "저장한 첫 글 선택");
  readnestApi.listArticlePage.mockResolvedValueOnce({
    items: [{ ...article, id: "a2", title: "둘째 글" }],
    nextCursor: null,
  });
  await press(tree, "더 불러오기");
  await press(tree, "둘째 글 선택");
  await type(tree, "저장한 글 검색", "다른 검색");
  await act(async () => jest.advanceTimersByTime(300));
  expect(text(tree)).toContain("2 개 선택");
  await press(tree, "선택한 글 연결");
  expect(knowledgeApi.linkArticle).toHaveBeenCalledWith("token-a", "t1", "a1");
  expect(knowledgeApi.linkArticle).toHaveBeenCalledWith("token-a", "t1", "a2");
  expect(props.onOpenThread).not.toHaveBeenCalled();
  expect(readnestApi.updateReadStatus).not.toHaveBeenCalled();
});
it("loads all membership pages before editing and saves additions/removals without deleting articles", async () => {
  knowledgeApi.articleTopics
    .mockResolvedValueOnce({ items: [topic], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [topic2], nextCursor: null });
  await render({ initialArticle: savedThread });
  expect(knowledgeApi.articleTopics).toHaveBeenCalledTimes(2);
  expect(
    button(tree, "AI 업무 활용 주제 선택").props.accessibilityState.checked,
  ).toBe(true);
  expect(button(tree, "AI 업무 활용 주제 선택").props["aria-checked"]).toBe(
    true,
  );
  await press(tree, "AI 업무 활용 주제 선택");
  await press(tree, "연결 저장");
  expect(knowledgeApi.unlinkArticle).toHaveBeenCalledWith(
    "token-a",
    "t1",
    "a1",
  );
  expect(knowledgeApi.deleteTopic).not.toHaveBeenCalled();
  expect(props.onOpenThread).not.toHaveBeenCalled();
});
it("retains only failed article selections and retries without reapplying successes", async () => {
  readnestApi.listArticlePage.mockResolvedValue({
    items: [article, { ...article, id: "a2", title: "둘째 글" }],
    nextCursor: null,
  });
  await render();
  await press(tree, "AI 업무 활용, 글 1개");
  await press(tree, "저장글 연결");
  await press(tree, "저장한 첫 글 선택");
  await press(tree, "둘째 글 선택");
  knowledgeApi.linkArticle
    .mockResolvedValueOnce(topic)
    .mockRejectedValueOnce(new Error("network"));
  await press(tree, "선택한 글 연결");
  expect(text(tree)).toContain("1개 글을 연결하지 못했어요");
  expect(
    button(tree, "저장한 첫 글 선택").props.accessibilityState.checked,
  ).toBe(false);
  expect(button(tree, "둘째 글 선택").props.accessibilityState.checked).toBe(
    true,
  );
  expect(button(tree, "둘째 글 선택").props["aria-checked"]).toBe(true);
  await press(tree, "선택한 글 연결");
  expect(knowledgeApi.linkArticle).toHaveBeenCalledTimes(3);
});
it("gates rapid double saves and ignores completions after account change", async () => {
  let resolve;
  knowledgeApi.createTopic.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render();
  await press(tree, "새 주제 만들기");
  await type(tree, "주제 이름", "새 주제");
  const handler = button(tree, "주제 저장").props.onPress;
  await act(async () => {
    handler();
    handler();
  });
  expect(knowledgeApi.createTopic).toHaveBeenCalledTimes(1);
  knowledgeApi.listTopics.mockResolvedValueOnce({
    items: [],
    nextCursor: null,
  });
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, token: "token-b" }),
    ),
  );
  await act(async () => resolve({ ...topic, name: "비공개 이전 계정 주제" }));
  expect(text(tree)).not.toContain("비공개 이전 계정 주제");
  expect(text(tree)).toContain("아직 주제가 없어요");
});
it("refreshes counts on return but keeps dirty editors intact", async () => {
  await render();
  await press(tree, "AI 업무 활용, 글 1개");
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, active: false }),
    ),
  );
  knowledgeApi.getTopic.mockResolvedValueOnce({ ...topic, articleCount: 9 });
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, active: true }),
    ),
  );
  expect(text(tree)).toMatch(/직접 모은 글\s+9\s*개/);
  await press(tree, "주제 편집");
  await type(tree, "주제 이름", "미저장 이름");
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, active: false }),
    ),
  );
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, active: true }),
    ),
  );
  expect(input(tree, "주제 이름").props.value).toBe("미저장 이름");
});

it("does not let a delayed return refresh overwrite a successful membership mutation", async () => {
  let finish;
  knowledgeApi.getTopic.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await press(tree, "AI 업무 활용, 글 1개");
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, active: false }),
    ),
  );
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, active: true }),
    ),
  );
  await press(tree, "저장한 첫 글 연결 해제");
  await act(async () => finish({ ...topic, articleCount: 7, revision: 1 }));
  expect(text(tree)).toMatch(/직접 모은 글\s+0\s*개/);
  expect(text(tree)).not.toMatch(/직접 모은 글\s+7\s*개/);
});

it("discards a return refresh error after navigation or a newer successful mutation", async () => {
  let fail;
  knowledgeApi.getTopic.mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  await render();
  await press(tree, "AI 업무 활용, 글 1개");
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, active: false }),
    ),
  );
  await act(async () =>
    tree.update(
      React.createElement(KnowledgeScreen, { ...props, active: true }),
    ),
  );
  await press(tree, "저장한 첫 글 연결 해제");
  await act(async () => fail(new Error("늦게 도착한 이전 오류")));
  expect(text(tree)).not.toContain("늦게 도착한 이전 오류");
  expect(text(tree)).toContain("주제 연결만 해제했어요");
});
