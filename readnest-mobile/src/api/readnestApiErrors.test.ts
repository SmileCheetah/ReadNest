import { request } from "./readnestApi";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it.each([
  [{ errorCode: "AI_UNAVAILABLE", code: "IGNORED" }, "AI_UNAVAILABLE"],
  [{ code: "TOPIC_REVISION_CONFLICT" }, "TOPIC_REVISION_CONFLICT"],
  [{ code: "TOPIC_NAME_EXISTS" }, "TOPIC_NAME_EXISTS"],
])("keeps structured API error identity for %j", async (fields, expected) => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({ ...fields, message: "입력을 확인해 주세요." }),
    });
  await expect(request("/knowledge/topics")).rejects.toMatchObject({
    status: 409,
    code: expected,
    message: "입력을 확인해 주세요.",
  });
});
