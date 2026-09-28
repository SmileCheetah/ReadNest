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

it("does not treat the initial empty cache as a new user before loading existing articles", async () => {
  await render();
  expect(hasInput()).toBe(false);
  await update({ isLoading: true });
  expect(hasInput()).toBe(false);
  await update({ hasLoaded: true, threads: [existing] });
  expect(hasInput()).toBe(false);
});

it("opens first-time capture only after a successful empty result, not after failure", async () => {
  await render({ errorMessage: "연결 실패" });
  expect(hasInput()).toBe(false);
  await update({ hasLoaded: true });
  expect(hasInput()).toBe(true);
});

it("preserves manual capture and opens incoming shared links", async () => {
  await render();
  await act(async () => tree.root.findByProps({ accessibilityLabel: "링크 저장" }).props.onPress());
  await update({ hasLoaded: true, threads: [existing] });
  expect(hasInput()).toBe(true);
  await act(async () => tree.root.findByProps({ accessibilityLabel: "링크 저장 입력 닫기" }).props.onPress());
  expect(hasInput()).toBe(false);
  await update({ hasLoaded: true, threads: [existing], pendingSharedUrl: "https://www.threads.com/@a/post/1" });
  expect(hasInput()).toBe(true);
});
