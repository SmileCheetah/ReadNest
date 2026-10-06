import { knowledgeApi } from "./knowledgeApi";
import { request } from "./readnestApi";
jest.mock("./readnestApi", () => ({
  request: jest.fn().mockResolvedValue({}),
}));
const mockedRequest = request as jest.Mock;
beforeEach(() => mockedRequest.mockClear());

it("uses scoped pagination/search with encoded parameters and authentication", async () => {
  const controller = new AbortController();
  await knowledgeApi.listTopics("token", {
    search: " AI 업무 ",
    cursor: "page/a",
    limit: 10,
    signal: controller.signal,
  });
  const [url, options] = mockedRequest.mock.calls[0];
  const parsed = new URL(`https://example.com${url}`);
  expect(parsed.pathname).toBe("/knowledge/topics");
  expect(parsed.searchParams.get("search")).toBe("AI 업무");
  expect(parsed.searchParams.get("cursor")).toBe("page/a");
  expect(options).toEqual({ token: "token", signal: controller.signal });
});
it("sends revision edits and idempotent membership mutations to distinct endpoints", async () => {
  await knowledgeApi.updateTopic("token", "topic/a", {
    name: "새 이름",
    description: "",
    expectedRevision: 3,
  });
  expect(mockedRequest).toHaveBeenLastCalledWith(
    "/knowledge/topics/topic%2Fa",
    {
      token: "token",
      method: "PATCH",
      body: { name: "새 이름", description: "", expectedRevision: 3 },
    },
  );
  await knowledgeApi.linkArticle("token", "t", "a");
  expect(mockedRequest).toHaveBeenLastCalledWith(
    "/knowledge/topics/t/articles/a",
    { token: "token", method: "PUT" },
  );
  await knowledgeApi.unlinkArticle("token", "t", "a");
  expect(mockedRequest).toHaveBeenLastCalledWith(
    "/knowledge/topics/t/articles/a",
    { token: "token", method: "DELETE" },
  );
});
