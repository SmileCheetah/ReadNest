// Renders the actual Expo web app with isolated, synthetic API responses.
// This does not certify native font scaling or TalkBack/VoiceOver behavior.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(new URL('../../readnest-api/package.json', import.meta.url));
const { chromium } = require('playwright');

const url = process.env.READNEST_QA_URL || 'http://localhost:8097';
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('Visual QA only runs against a local Expo preview.');
}
const output = process.env.READNEST_QA_OUTPUT || '/tmp/readnest-ux-verification';
await mkdir(output, { recursive: true });
const summary = '# AI 시대의 개발자는 판단한다\n\nAI가 코드를 작성해도 **무엇을 만들지 결정하고 결과를 검토하는 일**은 사람의 몫이다.\n\n### 소프트웨어 기본기가 필요한 이유\n\n**1. 전체 흐름을 이해한다**\n\nUI와 API, 인증과 데이터가 어떻게 연결되는지 알아야 결과를 판단할 수 있다.\n\n**2. 데이터를 설계한다**\n\n데이터 구조는 쉽게 바꾸기 어렵다. 정합성과 맥락을 처음부터 고려해야 한다.\n\n**3. 상황에 맞는 구조를 선택한다**\n\n사용자 수와 비용, 성능에 맞춰 기술을 선택한다. 지금 동작하는 것과 다음 단계에서도 버티는 것은 다르다.\n\n**4. 신뢰성과 보안을 갖춘다**\n\n테스트와 장애 대응, 보안은 개발 초기부터 설계한다.\n\n**5. 운영을 이어 간다**\n\n배포 후에도 모니터링과 복구, 성능 측정이 필요하다.\n\n### 한 줄 요약\n\n**AI 시대의 경쟁력은 코딩 속도보다 기술적 판단력에 있다.**';
const longSummary = '# 긴 문서 읽기 검증\n\n이 문서는 접힌 화면이 내용을 건너뛰지 않는지 확인하는 테스트 자료다.\n\n' + Array.from({ length: 35 }, (_, index) => `### ${index + 1}. 확인할 내용\n\n${'독립적인 주장과 조건을 순서대로 읽는다. 내용이 길어져도 중간 문단을 건너뛰어 결론만 먼저 보여주지 않는다. '.repeat(3)}`).join('\n\n');
const now = new Date().toISOString();
const user = { id: 'qa-user', email: 'qa@example.invalid', nickname: '읽기 테스트', createdAt: now, updatedAt: now };
function article(id, title, markdown, status = 'SUMMARY_DONE') {
  return {
    id, source: 'THREADS', url: `https://www.threads.com/@qa/post/${id}`, normalizedUrl: `https://www.threads.com/@qa/post/${id}`,
    title, author: 'qa', summary: markdown, rawText: null,
    summaryMeta: markdown ? { title, summaryMarkdown: markdown, oneLineSummary: '', coreSummary: markdown, summaryType: '자유 형식 요약', keyPoints: [], tags: [], caution: '', readingValue: '', contextStatus: '확인하지 못함', threadStatus: '해당 없음', confidence: 0 } : null,
    summaryPreview: markdown ? 'AI가 코드를 작성해도 무엇을 만들지 결정하고 결과를 검토하는 일은 사람의 몫이다.' : null,
    processStatus: status, readStatus: 'UNREAD', keyPoints: [], tags: [], savedAt: now, createdAt: now, updatedAt: now,
    generation: 1, resultGeneration: markdown ? 1 : null, generatedAt: markdown ? now : null,
    stage: status === 'SUMMARIZING' ? 'GENERATING' : status === 'SUMMARY_FAILED' ? 'FAILED' : 'DONE',
    retryable: true, retryAfterSeconds: 0, errorCode: status === 'SUMMARY_FAILED' ? 'EXTRACTION_FAILED' : null,
    lastSummaryError: status === 'SUMMARY_FAILED' ? '원문을 가져오지 못했어요. 원문 링크를 확인한 뒤 다시 시도해 주세요.' : null,
    sourceCompleteness: 'UNKNOWN', extractionStatus: 'SUCCESS', extractionConfidence: 0.8, summaryRetryCount: 0,
  };
}
const articles = [
  article('qa-ready', 'AI 시대의 개발자는 판단한다', summary),
  article('qa-processing', '요약을 준비하고 있어요', null, 'SUMMARIZING'),
  article('qa-failed', '원문을 확인해야 하는 글', null, 'SUMMARY_FAILED'),
  article('qa-long', '긴 문서 읽기 검증', longSummary),
];
const byId = new Map(articles.map((item) => [item.id, item]));
const errors = [];
const calls = [];
let processingPolls = 0;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  // Intercept every configured API host: a stale Expo env bundle must never hit a real backend.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    const apiPath = parsed.pathname.replace(/^\/api/, '');
    calls.push(`${request.method()} ${apiPath}`);
    const fulfill = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return fulfill({});
    if (apiPath === '/auth/guest') return fulfill({ accessToken: 'synthetic-qa-token', user }, 201);
    if (apiPath === '/auth/login') return fulfill({ accessToken: 'synthetic-qa-token', user }, 201);
    if (apiPath === '/auth/me') return fulfill(user);
    const match = apiPath.match(/^\/articles\/([^/]+)(.*)$/);
    if (match && byId.has(match[1])) {
      const item = byId.get(match[1]);
      if (match[2] === '/read-status' && request.method() === 'PATCH') Object.assign(item, request.postDataJSON());
      if (item.id === 'qa-processing' && request.method() === 'GET' && ++processingPolls >= 3) {
        Object.assign(item, article(item.id, '늦게 완료된 요약', '# 늦게 완료된 요약\n\n상태 조회가 늦게 완료된 결과를 자동으로 반영했다.'));
      }
      return fulfill(item);
    }
    if (apiPath === '/articles/home') return fulfill({ todayReading: articles, summarizing: articles.filter((item) => item.processStatus === 'SUMMARIZING'), today: articles, unreadCount: articles.length, weekSavedCount: articles.length });
    if (apiPath === '/articles') {
      let selected = articles.filter((item) => !parsed.searchParams.get('search') || item.title.includes(parsed.searchParams.get('search')));
      if (parsed.searchParams.get('readStatus')) selected = selected.filter((item) => item.readStatus === parsed.searchParams.get('readStatus'));
      if (parsed.searchParams.get('pagination') === 'cursor') {
        return fulfill({ items: selected.map(({ rawText, summary, summaryMeta, ...item }) => item), nextCursor: null });
      }
      return fulfill(selected);
    }
    return fulfill({ message: 'Unexpected synthetic QA route' }, 404);
  });
  await page.goto(url);
  await page.getByText('AI 시대의 개발자는 판단한다', { exact: true }).first().waitFor();
  assert.equal(await page.getByPlaceholder('이메일').count(), 0, 'Development guest mode skips the login form');
  assert.equal(await page.getByRole('button', { name: '링크 저장 입력 닫기', exact: true }).count(), 0, 'Existing users start with the capture panel closed');
  await page.screenshot({ path: path.join(output, 'home-390.png'), fullPage: true });
  await page.getByText('AI 시대의 개발자는 판단한다', { exact: true }).first().click();
  await page.getByText('데이터 구조는 쉽게 바꾸기 어렵다.', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(output, 'detail-390.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(output, 'detail-320.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'Document should not overflow horizontally at 320px');
  assert.equal((await page.locator('body').innerText()).split('AI 시대의 개발자는 판단한다').length - 1, 1, 'Display title exactly once');
  await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
  await page.getByText('늦게 완료된 요약', { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: '보관함', exact: true }).click();
  await page.getByText('긴 문서 읽기 검증', { exact: true }).first().click();
  await page.getByRole('button', { name: '전체 요약 펼치기', exact: true }).waitFor();
  assert.equal(await page.getByText('35. 확인할 내용', { exact: true }).count(), 0, 'Collapsed document hides the tail');
  await page.screenshot({ path: path.join(output, 'long-collapsed-320.png'), fullPage: true });
  await page.getByRole('button', { name: '전체 요약 펼치기', exact: true }).click();
  await page.getByText('35. 확인할 내용', { exact: true }).first().waitFor();
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ viewportWidths: [390, 320], errors, calls, overflow, mockedApi: true, nativeAccessibilityVerified: false }, null, 2));
  console.log(JSON.stringify({ success: true, output, screenshots: ['home-390.png', 'detail-390.png', 'detail-320.png', 'long-collapsed-320.png'], apiRequests: calls.length }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    console.error(JSON.stringify({ errors, calls, body: await page.locator('body').innerText() }, null, 2));
  }
  throw error;
} finally {
  await browser.close();
}
