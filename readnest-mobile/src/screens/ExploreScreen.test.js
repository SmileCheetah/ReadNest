const React = require("react");
const { act, create } = require("react-test-renderer");
const { ExploreScreen } = require("./ExploreScreen");
const { classificationApi } = require("../api/classificationApi");
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("../api/classificationApi", () => ({
  classificationApi: {
    list: jest.fn(),
    scan: jest.fn(),
    edit: jest.fn(),
    retry: jest.fn(),
  },
}));
jest.mock("../api/readnestApi", () => ({
  readnestApi: { getArticle: jest.fn() },
}));
const article = {
  id: "a",
  title: "데이터 설계",
  summaryPreview: "데이터 정합성",
  processStatus: "SUMMARY_DONE",
  classification: {
    kind: "ARTICLE",
    categories: ["개발"],
    state: "SUCCEEDED",
    revision: 2,
    userEdited: false,
  },
};
const page = {
  articles: [article],
  nextCursor: null,
  categories: { ARTICLE: ["개발", "경제·금융"], OPEN_SOURCE: ["개발 도구"] },
};
let tree;
const output = () => JSON.stringify(tree.toJSON());
const press = async (label, role) => {
  await act(async () =>
    tree.root
      .findAll(
        (node) =>
          node.props.accessibilityLabel === label &&
          (!role || node.props.accessibilityRole === role) &&
          typeof node.props.onPress === "function",
      )[0]
      .props.onPress(),
  );
};
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  classificationApi.list.mockResolvedValue(page);
  classificationApi.scan.mockResolvedValue({
    queued: 0,
    more: false,
    pending: false,
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.clearAllMocks();
});
async function mount(props = {}) {
  await act(async () => {
    tree = create(
      React.createElement(ExploreScreen, {
        token: "t",
        onOpenThread: jest.fn(),
        onOpenArchive: jest.fn(),
        onOpenCollections: jest.fn(),
        ...props,
      }),
    );
  });
}
it("separates open source use cases from normal topics", async () => {
  await mount();
  expect(output()).toContain("경제·금융");
  await press("오픈소스");
  expect(classificationApi.list).toHaveBeenLastCalledWith(
    "t",
    "OPEN_SOURCE",
    undefined,
    undefined,
    expect.anything(),
  );
  expect(output()).toContain("개발 도구");
  expect(output()).not.toContain("경제·금융");
});
it("saves user correction with revision and selected category", async () => {
  await mount();
  await press("데이터 설계 분류 수정");
  await press("경제·금융", "checkbox");
  await press("분류 저장");
  expect(classificationApi.edit).toHaveBeenCalledWith("t", "a", {
    kind: "ARTICLE",
    categories: ["개발", "경제·금융"],
    revision: 2,
  });
});
it("shows saved posts even when automatic dispatch fails", async () => {
  classificationApi.scan.mockRejectedValueOnce(new Error("offline"));
  await mount();
  expect(output()).toContain("자동 분류를 시작하지 못했어요");
  expect(output()).toContain("데이터 설계");
});
it("does not scan while the screen is hidden", async () => {
  await mount({ active: false });
  expect(classificationApi.scan).not.toHaveBeenCalled();
});
it("offers archive and preserves manual collections", async () => {
  const onOpenArchive = jest.fn();
  const onOpenCollections = jest.fn();
  await mount({ onOpenArchive, onOpenCollections });
  await press("전체 보관함");
  await press("내가 만든 모음");
  expect(onOpenArchive).toHaveBeenCalled();
  expect(onOpenCollections).toHaveBeenCalled();
});
