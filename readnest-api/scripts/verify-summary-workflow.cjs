/* Runs only against explicitly isolated local QA services. No real AI/source calls. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const database = new URL(process.env.DATABASE_URL || 'mysql://invalid');
const redis = new URL(process.env.REDIS_URL || 'redis://invalid');
if (
  process.env.READNEST_ISOLATED_QA !== '1' ||
  database.hostname !== '127.0.0.1' || database.port !== '13307' ||
  database.pathname !== '/readnest_qa' ||
  redis.hostname !== '127.0.0.1' || redis.port !== '16379'
) {
  throw new Error('Refusing to run outside the explicitly isolated readnest_qa database and Redis ports.');
}
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = `isolated-qa-${randomUUID()}`;
process.env.OPENAI_API_KEY = 'not-a-real-key-never-used';
process.env.DAILY_SAVE_LIMIT = '50';
process.env.SUMMARY_RETRY_LIMIT = '10';

const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { ContentExtractorService } = require('../dist/summary/content-extractor.service');
const { AiSummaryService } = require('../dist/summary/ai-summary.service');
const { ThreadDetectionService } = require('../dist/summary/thread-detection.service');
const { SummaryJobService } = require('../dist/summary/summary-job.service');
const { SummaryGenerationError } = require('../dist/summary/summary-errors');

const rawText = 'AI가 코드를 작성해도 무엇을 만들지와 결과가 맞는지는 사람이 판단한다. 데이터 구조는 쉽게 바꾸기 어려우며 정합성과 맥락을 고려해야 한다. 테스트와 보안은 초기 설계부터, 운영과 장애 대응은 배포 후에도 계속 필요하다.';
const markdown = '# AI 시대의 소프트웨어 판단력\n\nAI가 구현을 도와도 **무엇을 만들지와 결과가 맞는지**는 사람이 판단한다.\n\n### 데이터와 운영\n\n데이터 구조와 정합성을 설계하고 테스트·보안을 처음부터 고려해야 한다.\n\n> 배포 후에도 운영과 장애 대응은 계속된다.';
const inputs = [];
const sourceFailures = new Set();
const gates = new Map();
const userIds = [];
let app;
let prisma;
let baseUrl;
let failures = 0;

function gateFor(post) {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  const gate = { promise, release, entered: false };
  gates.set(post, gate);
  return gate;
}

async function eventually(check, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

async function request(path, token, method = 'GET', body, idempotencyKey) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function complete(id, token, generation) {
  return eventually(async () => {
    const result = await request(`/articles/${id}`, token);
    return result.status === 200 && result.body.generation === generation &&
      result.body.processStatus === 'SUMMARY_DONE' ? result.body : null;
  }, `article ${id}, generation ${generation} completed`);
}

async function scenario(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); throw error; }
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ContentExtractorService).useValue({
      async extract(url) {
        const failed = [...sourceFailures].some((post) => url.includes(post));
        return {
          title: 'QA 원문', text: failed ? '' : rawText,
          extractionStatus: failed ? 'FAILED' : 'SUCCESS',
          extractionConfidence: failed ? 0 : 0.9,
          sourceCompleteness: 'UNKNOWN',
        };
      },
    })
    .overrideProvider(AiSummaryService).useValue({
      async summarize(input) {
        inputs.push(input.text);
        const gate = [...gates.entries()].find(([post]) => input.url.includes(post))?.[1];
        if (gate) { gate.entered = true; await gate.promise; }
        return {
          title: 'AI 시대의 소프트웨어 판단력', summary: markdown,
          keyPoints: [], tags: [], contextInsufficient: false,
          meta: {
            summaryType: '자유 형식 요약', title: 'AI 시대의 소프트웨어 판단력',
            oneLineSummary: 'AI가 구현을 도와도 판단은 사람의 몫이다.',
            coreSummary: markdown, keyPoints: [], tags: [], conclusion: '',
            readingValue: '', caution: '', contextStatus: '확인하지 못함',
            threadStatus: '해당 없음', confidence: 0, summaryMarkdown: markdown,
          },
        };
      },
    })
    .overrideProvider(ThreadDetectionService).useValue({
      async detectAndLink() { throw new Error('Intentional auxiliary detection failure'); },
    }).compile();
  app = moduleRef.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  baseUrl = `${await app.getUrl()}/api`;
  prisma = app.get(PrismaService);
  const account = await request('/auth/signup', null, 'POST', {
    email: `qa-${randomUUID()}@example.invalid`, password: 'QA-only-Password-123!', nickname: '격리 테스트',
  });
  assert.equal(account.status, 201);
  userIds.push(account.body.user.id);
  const token = account.body.accessToken;
  let saved;

  await scenario('external URL rejection, authenticated API boundary', async () => {
    assert.equal((await request('/articles', token, 'POST', { url: 'http://127.0.0.1:3000/private' })).status, 400);
    assert.equal((await request('/articles')).status, 401);
  });
  await scenario('concurrent duplicate save creates one document and one generation', async () => {
    const gate = gateFor('QaAlpha01');
    const results = await Promise.all([
      request('/articles', token, 'POST', { url: 'https://www.threads.com/@qa/post/QaAlpha01?xmt=one' }),
      request('/articles', token, 'POST', { url: 'https://www.threads.net/@qa/post/QaAlpha01?xmt=two' }),
    ]);
    for (const result of results) assert.equal(result.status, 201);
    assert.equal(results[0].body.id, results[1].body.id);
    saved = results[0].body;
    gate.release();
    saved = await complete(saved.id, token, saved.generation);
    assert.equal(inputs.length, 1);
    assert.equal(saved.summaryMeta.summaryMarkdown, markdown);
    assert.notEqual(saved.sourceCompleteness, 'COMPLETE');
  });
  await scenario('duplicate after completion preserves summary and does not re-enqueue', async () => {
    const result = await request('/articles', token, 'POST', { url: 'https://www.threads.com/@qa/post/QaAlpha01?hl=ko' });
    assert.equal(result.body.id, saved.id);
    assert.equal(result.body.generation, saved.generation);
    assert.equal(result.body.summaryMeta.summaryMarkdown, markdown);
  });
  await scenario('idempotent regeneration and source snapshot replacement', async () => {
    const key = randomUUID();
    const results = await Promise.all([
      request(`/articles/${saved.id}/summary/retry`, token, 'POST', undefined, key),
      request(`/articles/${saved.id}/summary/retry`, token, 'POST', undefined, key),
    ]);
    assert.equal(results[0].status, 201);
    assert.equal(results[1].status, 201);
    saved = await complete(saved.id, token, saved.generation + 1);
    const replay = await request(`/articles/${saved.id}/summary/retry`, token, 'POST', undefined, key);
    assert.equal(replay.body.generation, saved.generation);
    assert.equal(inputs.length, 2);
    assert.ok(inputs.every((input) => input === rawText));
  });
  await scenario('failed source regeneration preserves last successful Markdown without an AI call', async () => {
    sourceFailures.add('QaAlpha01');
    const result = await request(`/articles/${saved.id}/summary/retry`, token, 'POST', undefined, randomUUID());
    assert.equal(result.status, 201);
    const failed = await eventually(async () => {
      const response = await request(`/articles/${saved.id}`, token);
      return response.body.processStatus === 'SUMMARY_FAILED' ? response.body : null;
    }, 'source failure reaches terminal state');
    assert.equal(failed.summaryMeta.summaryMarkdown, markdown);
    assert.equal(failed.resultGeneration, saved.resultGeneration);
    assert.equal(inputs.length, 2);
    sourceFailures.clear();
  });
  await scenario('lightweight cursor pages and ownership', async () => {
    const other = await request('/articles', token, 'POST', { url: 'https://www.threads.com/@qa/post/QaBeta02' });
    assert.equal(other.status, 201);
    await complete(other.body.id, token, other.body.generation);
    const first = await request('/articles?pagination=cursor&limit=1&period=all', token);
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 1);
    assert.ok(first.body.nextCursor);
    for (const field of ['rawText', 'summary', 'summaryMeta']) assert.equal(field in first.body.items[0], false);
    const second = await request(`/articles?pagination=cursor&limit=1&period=all&cursor=${encodeURIComponent(first.body.nextCursor)}`, token);
    assert.equal(second.status, 200);
    assert.notEqual(first.body.items[0].id, second.body.items[0].id);
    assert.equal((await request(`/articles?pagination=cursor&period=all&search=other&cursor=${encodeURIComponent(first.body.nextCursor)}`, token)).status, 400);
    const status = await request(`/articles/${saved.id}/summary/status`, token);
    for (const field of ['rawText', 'summary', 'summaryMeta']) assert.equal(field in status.body, false);
    assert.equal((await request('/articles', token)).body instanceof Array, true);
    const stranger = await request('/auth/signup', null, 'POST', {
      email: `qa-${randomUUID()}@example.invalid`, password: 'QA-only-Password-123!', nickname: '다른 사용자',
    });
    userIds.push(stranger.body.user.id);
    assert.equal((await request(`/articles/${saved.id}`, stranger.body.accessToken)).status, 404);
    assert.equal((await request(`/articles/${saved.id}/summary/retry`, stranger.body.accessToken, 'POST')).status, 404);
  });
  await scenario('deletion during generation cannot resurrect the article', async () => {
    const gate = gateFor('QaDelete03');
    const result = await request('/articles', token, 'POST', { url: 'https://www.threads.com/@qa/post/QaDelete03' });
    assert.equal(result.status, 201);
    await eventually(() => gate.entered, 'worker entered mocked generation');
    assert.ok([200, 204].includes((await request(`/articles/${result.body.id}`, token, 'DELETE')).status));
    gate.release();
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal((await request(`/articles/${result.body.id}`, token)).status, 404);
  });
  await scenario('queue publication failure retains accepted work and recovers', async () => {
    const jobs = app.get(SummaryJobService);
    const queue = jobs.queue;
    const originalAdd = queue.add;
    let queued;
    try {
      queue.add = async () => { throw new Error('Isolated injected queue outage'); };
      const response = await request('/articles', token, 'POST', { url: 'https://www.threads.com/@qa/post/QaQueue04' });
      assert.equal(response.status, 201);
      queued = response.body;
      const task = await prisma.summaryTask.findFirstOrThrow({ where: { articleId: queued.id } });
      assert.equal(task.state, 'PENDING');
      assert.equal(task.attempts, 0);
    } finally { queue.add = originalAdd; }
    await eventually(() => !jobs.dispatching, 'failed dispatch unwinds');
    await jobs.dispatch();
    await complete(queued.id, token, queued.generation);
  });
  await scenario('expired lease recovery and concurrent claims reject stale writes in MySQL', async () => {
    // Stop this isolated app's periodic dispatcher while directly driving lease boundaries.
    app.get(SummaryJobService).onModuleDestroy();
    const document = await prisma.savedArticle.create({ data: {
      userId: userIds[0], url: 'https://www.threads.com/@qa/post/QaLease05',
      normalizedUrl: `qa-lease-${randomUUID()}`, generation: 1, processStatus: 'SUMMARIZING',
    } });
    const task = await prisma.summaryTask.create({ data: {
      articleId: document.id, generation: 1, state: 'RUNNING', attempts: 1,
      leaseToken: 'expired-lease', leaseExpiresAt: new Date(Date.now() - 1000),
    } });
    const jobs = new SummaryJobService(prisma, { add: async () => ({}) });
    await jobs.dispatch();
    const data = { articleId: document.id, generation: 1, taskId: task.id };
    const claimed = await Promise.all([jobs.claim(data), jobs.claim(data)]);
    assert.equal(claimed.filter(Boolean).length, 1);
    const stale = { ...data, token: 'expired-lease' };
    assert.equal(await jobs.complete(stale, { summary: 'STALE' }), false);
    await jobs.fail(stale, new SummaryGenerationError('STALE'), 1);
    const lease = claimed.find(Boolean).lease;
    assert.equal(await jobs.complete(lease, { summary: 'LATEST', processStatus: 'SUMMARY_DONE' }), true);
    const result = await prisma.savedArticle.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(result.summary, 'LATEST');
    assert.equal(result.resultGeneration, 1);
    assert.equal(result.processStatus, 'SUMMARY_DONE');
  });
  await scenario('more than 100 legacy documents have stable cursor pages and previews', async () => {
    const batch = randomUUID();
    const savedAt = new Date();
    await prisma.savedArticle.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
      id: `bulk-${batch}-${String(index).padStart(3, '0')}`, userId: userIds[0],
      url: `https://www.threads.com/@qa/post/Bulk${index}`, normalizedUrl: `qa-${batch}-${index}`,
      title: 'QA archive measure', summary: markdown, summaryMeta: { summaryMarkdown: markdown },
      rawText: rawText.repeat(80), summaryPreview: null, processStatus: 'SUMMARY_DONE', savedAt,
    })) });
    const ids = new Set();
    const payloadBytes = [];
    const latencyMs = [];
    let cursor;
    do {
      const started = performance.now();
      const page = await request(`/articles?pagination=cursor&period=all&limit=40&search=QA%20archive%20measure${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token);
      latencyMs.push(Math.round(performance.now() - started));
      payloadBytes.push(Buffer.byteLength(JSON.stringify(page.body)));
      assert.equal(page.status, 200);
      for (const item of page.body.items) {
        assert.equal(ids.has(item.id), false, 'No duplicated cursor boundary');
        ids.add(item.id);
        assert.ok(item.summaryPreview?.includes('AI가 구현을 도와도'), 'Legacy null preview derived without AI');
        for (const field of ['rawText', 'summary', 'summaryMeta']) assert.equal(field in item, false);
      }
      cursor = page.body.nextCursor;
    } while (cursor);
    assert.equal(ids.size, 105);
    console.log(JSON.stringify({ syntheticCursorMeasurement: { rows: ids.size, pages: payloadBytes.length, payloadBytes, latencyMs }, productionBenchmark: false }));
  });
  console.log(`Isolated workflow verification complete: 10 scenarios, ${inputs.length} mocked AI calls; no external provider calls.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  for (const gate of gates.values()) gate.release();
  if (prisma && userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (app) await app.close();
  if (failures) process.exitCode = 1;
});
