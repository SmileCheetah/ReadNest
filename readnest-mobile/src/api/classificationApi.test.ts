import { classificationApi } from "./classificationApi";
import { request } from "./readnestApi";
jest.mock("./readnestApi", () => ({
  request: jest.fn().mockResolvedValue({}),
}));
it("sends correction as an object, not double-encoded JSON", async () => {
  const body = { kind: "ARTICLE" as const, categories: ["개발"], revision: 2 };
  await classificationApi.edit("token", "a", body);
  expect(request).toHaveBeenCalledWith("/knowledge/classifications/a", {
    token: "token",
    method: "PATCH",
    body,
  });
});
