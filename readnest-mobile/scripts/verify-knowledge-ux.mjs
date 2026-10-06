// Actual Expo web UI with synthetic topic/article APIs. No real user data or AI calls.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(
  new URL("../../readnest-api/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const url = process.env.READNEST_QA_URL || "http://localhost:8097";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local preview only.");
const output = process.env.READNEST_QA_OUTPUT || "/tmp/readnest-knowledge-ux";
await mkdir(output, { recursive: true });
const now = new Date().toISOString();
const user = {
  id: "topic-qa-user",
  email: "topic-qa@example.invalid",
  nickname: "주제 테스트",
  createdAt: now,
  updatedAt: now,
};
const markdown =
  "# AI 활용의 기준\n\n**도구보다 문제를 판단하는 능력이 중요하다.**\n\n### 기억할 내용\n\n저장한 글을 주제로 연결해 다시 찾아본다.";
const articles = ["AI 활용의 기준", "작은 서비스를 운영하는 방법"].map(
  (title, i) => ({
    id: `qa-article-${i}`,
    title,
    source: "THREADS",
    author: "qa",
    url: `https://www.threads.com/@qa/post/topic${i}`,
    normalizedUrl: `https://www.threads.com/@qa/post/topic${i}`,
    rawText: null,
    summary: markdown,
    summaryMeta: { title, summaryMarkdown: markdown, tags: [], keyPoints: [] },
    summaryPreview:
      "주요 주장과 맥락을 연결해 다시 찾아보기 위한 테스트 글입니다.",
    processStatus: "SUMMARY_DONE",
    readStatus: "UNREAD",
    tags: [],
    keyPoints: [],
    savedAt: now,
    createdAt: now,
    updatedAt: now,
    generation: 1,
    resultGeneration: 1,
    generatedAt: now,
    summaryVariants: [],
    stage: "DONE",
    retryable: false,
    sourceCompleteness: "UNKNOWN",
    extractionStatus: "SUCCESS",
    summaryRetryCount: 0,
  }),
);
const topics = new Map();
const links = new Map();
const calls = [],
  errors = [];
let nextId = 1,
  failListOnce = false,
  conflictOnce = false;
const dto = (topic) => ({
  ...topic,
  articleCount: links.get(topic.id)?.size ?? 0,
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      parsed = new URL(req.url()),
      p = parsed.pathname.replace(/^\/api/, ""),
      method = req.method();
    calls.push(`${method} ${p}`);
    const body =
      method === "POST" || method === "PATCH" ? req.postDataJSON() : null;
    const send = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
        },
        body: JSON.stringify(data),
      });
    if (method === "OPTIONS") return send({});
    if (p === "/auth/guest" || p === "/auth/login")
      return send({ accessToken: "synthetic-topic-qa-token", user }, 201);
    if (p === "/auth/me") return send(user);
    if (p === "/articles/home")
      return send({
        todayReading: articles,
        summarizing: [],
        today: articles,
        unreadCount: 2,
        weekSavedCount: 2,
      });
    if (p === "/articles")
      return send({
        items: articles.filter((a) =>
          a.title.includes(parsed.searchParams.get("search") || ""),
        ),
        nextCursor: null,
      });
    const articleMatch = p.match(/^\/articles\/([^/]+)(.*)$/);
    if (articleMatch) {
      const a = articles.find((a) => a.id === articleMatch[1]);
      if (!a) return send({ message: "글 없음" }, 404);
      if (method === "PATCH") Object.assign(a, body);
      return send(a);
    }
    if (p === "/knowledge/topics") {
      if (method === "POST") {
        const id = `qa-topic-${nextId++}`;
        const topic = {
          id,
          name: body.name,
          description: body.description || null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        topics.set(id, topic);
        links.set(id, new Set());
        return send(dto(topic), 201);
      }
      if (failListOnce) {
        failListOnce = false;
        return send({ message: "테스트 연결 오류" }, 503);
      }
      return send({
        items: [...topics.values()]
          .filter((t) =>
            t.name.includes(parsed.searchParams.get("search") || ""),
          )
          .map(dto),
        nextCursor: null,
      });
    }
    const at = p.match(/^\/knowledge\/articles\/([^/]+)\/topics$/);
    if (at)
      return send({
        items: [...topics.values()]
          .filter((t) => links.get(t.id).has(at[1]))
          .map(dto),
        nextCursor: null,
      });
    const match = p.match(
      /^\/knowledge\/topics\/([^/]+)(?:\/articles(?:\/([^/]+))?)?$/,
    );
    if (match) {
      const topic = topics.get(match[1]);
      if (!topic) return send({ message: "주제를 찾을 수 없습니다." }, 404);
      if (match[2]) {
        const connected = links.get(topic.id);
        if (method === "PUT" && !connected.has(match[2])) {
          connected.add(match[2]);
          topic.revision++;
        }
        if (method === "DELETE" && connected.has(match[2])) {
          connected.delete(match[2]);
          topic.revision++;
        }
        return send(dto(topic));
      }
      if (p.endsWith("/articles"))
        return send({
          items: articles.filter(
            (a) =>
              links.get(topic.id).has(a.id) &&
              a.title.includes(parsed.searchParams.get("search") || ""),
          ),
          nextCursor: null,
        });
      if (method === "PATCH") {
        if (conflictOnce) {
          conflictOnce = false;
          topic.revision++;
          topic.description = "다른 화면에서 저장한 설명";
          return send(
            {
              code: "TOPIC_REVISION_CONFLICT",
              message: "주제가 변경되었습니다. 최신 내용을 확인해 주세요.",
            },
            409,
          );
        }
        Object.assign(topic, {
          name: body.name,
          description: body.description,
          revision: topic.revision + 1,
        });
      }
      if (method === "DELETE") {
        topics.delete(topic.id);
        links.delete(topic.id);
        return send({ deleted: true, id: topic.id });
      }
      return send(dto(topic));
    }
    return send({ message: "Unexpected QA route" }, 404);
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const snap = (name) =>
    page.screenshot({ path: path.join(output, name), fullPage: true });
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "No horizontal page overflow",
    );
  await page.goto(url);
  await page.getByText(articles[0].title, { exact: true }).first().waitFor();
  await page.getByRole("tab", { name: "보관함", exact: true }).click();
  await button("주제로 모아보기").click();
  await page.getByText("아직 주제가 없어요.", { exact: false }).waitFor();
  await snap("topics-empty-390.png");
  await button("새 주제 만들기").click();
  await page
    .getByRole("textbox", { name: "주제 이름", exact: true })
    .fill("AI 업무 활용");
  await page
    .getByRole("textbox", { name: "주제 설명", exact: true })
    .fill("읽은 글을 실제 업무와 연결하고 다시 활용하기");
  await button("주제 저장").click();
  await page.getByText("직접 모은 글 0개", { exact: true }).waitFor();
  await button("저장글 연결").click();
  await page
    .getByRole("checkbox", { name: `${articles[0].title} 선택`, exact: true })
    .click();
  assert.equal(
    calls.some((call) => call.includes("/read-status")),
    false,
    "Selecting articles must not mark them read",
  );
  await button("선택한 글 연결").click();
  await page.getByText("직접 모은 글 1개", { exact: true }).waitFor();
  await snap("topic-detail-390.png");
  await button("뒤로").click();
  await button("AI 업무 활용, 글 1개").waitFor();
  await snap("topics-list-390.png");
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow();
  await snap("topics-list-320.png");
  await button("AI 업무 활용, 글 1개").click();
  await button(`${articles[0].title} 읽기`).click();
  await page
    .getByText("도구보다 문제를 판단하는 능력이 중요하다.", { exact: true })
    .waitFor();
  await button("더보기").click();
  await button("주제에 추가").click();
  await page
    .getByRole("checkbox", { name: "AI 업무 활용 주제 선택", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "AI 업무 활용 주제 선택", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await snap("article-topic-picker-320.png");
  await page
    .getByRole("checkbox", { name: "AI 업무 활용 주제 선택", exact: true })
    .click();
  await button("뒤로").click();
  await page
    .getByText("변경 사항을 저장하지 않고 나갈까요?", { exact: true })
    .waitFor();
  await button("계속 작성하기").click();
  await button("연결 저장").click();
  await page.getByText("주제 연결을 저장했어요.", { exact: false }).waitFor();
  await button("뒤로").click();
  await button("뒤로가기").click();
  await page.getByText("직접 모은 글 0개", { exact: true }).waitFor();
  await button("주제 편집").click();
  const nameInput = page.getByRole("textbox", {
    name: "주제 이름",
    exact: true,
  });
  await nameInput.fill("AI 판단과 업무 설계");
  conflictOnce = true;
  await button("주제 저장").click();
  await button("최신 정보 확인").click();
  await page.getByText("서버에 저장된 최신 내용", { exact: true }).waitFor();
  assert.equal(
    await nameInput.inputValue(),
    "AI 판단과 업무 설계",
    "Conflict preserves typed input",
  );
  await button("주제 저장").click();
  await button("주제 편집").waitFor();
  await noOverflow();
  // Web stress check only: manually doubled text is not a native font-scale certification.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(
      '[dir="auto"], input, textarea',
    )) {
      const computed = getComputedStyle(el);
      el.dataset.qaFont = el.style.fontSize;
      el.dataset.qaLine = el.style.lineHeight;
      el.style.fontSize = `${parseFloat(computed.fontSize) * 2}px`;
      if (computed.lineHeight !== "normal")
        el.style.lineHeight = `${parseFloat(computed.lineHeight) * 2}px`;
    }
  });
  await snap("topic-detail-text-stress-320.png");
  await noOverflow();
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-qa-font]")) {
      el.style.fontSize = el.dataset.qaFont;
      el.style.lineHeight = el.dataset.qaLine;
    }
  });
  await button("주제 삭제").click();
  await page
    .getByText("저장글과 요약은 보관함에 그대로 남습니다.", { exact: false })
    .waitFor();
  await snap("topic-delete-confirm-320.png");
  await button("주제 삭제 확인").click();
  await page.getByText("아직 주제가 없어요.", { exact: false }).waitFor();
  assert.equal(articles.length, 2, "Deleting a topic keeps saved articles");
  await button("뒤로").click();
  failListOnce = true;
  await button("주제로 모아보기").click();
  await button("다시 불러오기").waitFor();
  await snap("topics-error-retry-320.png");
  await button("다시 불러오기").click();
  await page.getByText("아직 주제가 없어요.", { exact: false }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(
    calls.some((call) => call.includes("/summary")),
    false,
    "Topic flow must not trigger AI summaries",
  );
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        widths: [390, 320],
        api: "synthetic",
        errors,
        calls,
        nativeAccessibilityVerified: false,
        textStressOnly: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, output, apiCalls: calls.length }, null, 2),
  );
} catch (error) {
  if (page) {
    await snapFailure();
  }
  throw error;
} finally {
  await browser.close();
}
async function snapFailure() {
  await page.screenshot({
    path: path.join(output, "failure.png"),
    fullPage: true,
  });
  console.error(
    JSON.stringify(
      { errors, calls, body: await page.locator("body").innerText() },
      null,
      2,
    ),
  );
}
