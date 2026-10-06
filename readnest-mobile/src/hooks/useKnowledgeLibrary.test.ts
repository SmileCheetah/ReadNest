import { createElement } from "react";
import { useKnowledgePage } from "./useKnowledgeLibrary";
import { validateTopicInput } from "../data/knowledge";
import type { KnowledgePage } from "../data/knowledge";
const { act, create } = require("react-test-renderer");
type Item = { id: string };
let state: ReturnType<typeof useKnowledgePage<Item>>;
let tree: any;
const loader = jest.fn<Promise<KnowledgePage<Item>>, [string?, AbortSignal?]>();
function Harness({ scope }: { scope: string }) {
  state = useKnowledgePage(scope, loader);
  return null;
}
async function render(scope: string) {
  await act(async () => {
    tree = create(createElement(Harness, { scope }));
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  loader.mockReset();
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
});

it("discards slow results from old token/topic/search scopes", async () => {
  let finish!: (page: KnowledgePage<Item>) => void;
  loader.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render("user-a:topic-a:search-a");
  loader.mockResolvedValueOnce({ items: [{ id: "new" }], nextCursor: null });
  await act(async () =>
    tree.update(createElement(Harness, { scope: "user-b:topic-b:search-b" })),
  );
  await act(async () => finish({ items: [{ id: "old" }], nextCursor: null }));
  expect(state.items).toEqual([{ id: "new" }]);
});
it("preserves loaded pages after a failed next page and retries the same cursor", async () => {
  loader.mockResolvedValueOnce({ items: [{ id: "one" }], nextCursor: "next" });
  await render("scope");
  loader.mockRejectedValueOnce(new Error("network"));
  await act(async () => state.loadMore());
  expect(state.items).toEqual([{ id: "one" }]);
  expect(state.error).toBe("network");
  loader.mockResolvedValueOnce({
    items: [{ id: "one" }, { id: "two" }],
    nextCursor: null,
  });
  await act(async () => state.retry());
  expect(loader).toHaveBeenLastCalledWith("next", expect.anything());
  expect(state.items).toEqual([{ id: "one" }, { id: "two" }]);
});
it("validates codepoints without silently truncating title or description", () => {
  expect(validateTopicInput(" ", "")).toContain("이름");
  expect(validateTopicInput("😀".repeat(80), "")).toBeNull();
  expect(validateTopicInput("😀".repeat(81), "")).toContain("80");
  expect(validateTopicInput("이름", "a".repeat(2001))).toContain(
    "2,000".replace(",", ""),
  );
});
