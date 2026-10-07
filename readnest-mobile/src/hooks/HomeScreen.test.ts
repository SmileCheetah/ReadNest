import { createElement } from "react";
import { TextInput } from "react-native";
import { HomeScreen } from "../../App";
import type { SavedThread } from "../data/mockThreads";

const { act, create } = require("react-test-renderer");
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../components/ThreadCard", () => ({ ThreadCard: () => null }));
const existing = { id: "existing", title: "저장한 글", processStatus: "SUMMARY_DONE", readStatus: "UNREAD" } as SavedThread;
const props = {
  url: "", onChangeUrl: jest.fn(), onSave: jest.fn(), isSaving: false,
  isLoading: false, hasLoaded: false, errorMessage: null, pendingSharedUrl: null,
  threads: [] as SavedThread[], saveNotice: null, onRefresh: jest.fn(),
  onShowUnread: jest.fn(), onOpenThread: jest.fn(),
};
let tree: any;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
const render = async (changes = {}) => { await act(async () => { tree = create(createElement(HomeScreen, { ...props, ...changes })); }); };
const update = async (changes = {}) => { await act(async () => tree.update(createElement(HomeScreen, { ...props, ...changes }))); };
const hasInput = () => tree.root.findAllByType(TextInput).length > 0;

it("keeps the link form visible before and after loading existing articles", async () => {
  await render();
  expect(hasInput()).toBe(true);
  await update({ isLoading: true });
  expect(hasInput()).toBe(true);
  await update({ hasLoaded: true, threads: [existing] });
  expect(hasInput()).toBe(true);
});

it("keeps the link form visible after an article-loading failure", async () => {
  await render({ errorMessage: "연결 실패" });
  expect(hasInput()).toBe(true);
  await update({ hasLoaded: true });
  expect(hasInput()).toBe(true);
});

it("never offers a collapse control after saving or receiving a shared link", async () => {
  await render();
  const saveButton = tree.root.findAll((node: any) => node.props.onPress === props.onSave)[0];
  await act(async () => saveButton.props.onPress());
  expect(props.onSave).toHaveBeenCalled();
  await update({ hasLoaded: true, threads: [existing], saveNotice: "저장했어요." });
  expect(hasInput()).toBe(true);
  await update({ hasLoaded: true, threads: [existing], pendingSharedUrl: "https://www.threads.com/@a/post/1" });
  expect(hasInput()).toBe(true);
  expect(tree.root.findAllByProps({ accessibilityLabel: "링크 저장 입력 닫기" })).toHaveLength(0);
});
