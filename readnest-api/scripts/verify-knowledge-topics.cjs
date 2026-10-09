#!/usr/bin/env node
/*
 * Local MySQL + HTTP integration verification for manual knowledge topics.
 * Run after building and applying the reviewed migration:
 *   READNEST_LOCAL_KNOWLEDGE_QA=1 node scripts/verify-knowledge-topics.cjs
 *
 * Authentication is SYNTHETIC: this tests owner isolation, not JWT signing or
 * validation. Only KnowledgeModule, PrismaModule and ConfigModule are loaded.
 * No AppModule, Redis workers, extractor, paid model or external URL is used.
 * Creates uniquely named QA users and removes only those exact users in finally.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');

// A repository .env must never be able to opt into a database-writing QA run.
if (process.env.READNEST_LOCAL_KNOWLEDGE_QA !== '1') {
  console.error('REFUSED: set READNEST_LOCAL_KNOWLEDGE_QA=1 explicitly for local QA.');
  process.exit(1);
}
require('dotenv').config({ path: join(__dirname, '..', '.env'), quiet: true });
let database;
try {
  database = new URL(process.env.DATABASE_URL || '');
} catch {
  console.error('REFUSED: a valid local DATABASE_URL is required.');
  process.exit(1);
}
if (
  database.protocol !== 'mysql:' ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.port !== '3307' ||
  database.pathname !== '/readnest' ||
  database.hash ||
  [...database.searchParams.keys()].some(
    (key) => !['connection_limit', 'pool_timeout', 'connect_timeout'].includes(key),
  )
) {
  console.error('REFUSED: only the local mysql database readnest on port 3307 is allowed.');
  process.exit(1);
}
process.env.NODE_ENV = 'test';
// Cursor signing is real, but uses a throwaway key rather than the user's JWT key.
process.env.JWT_SECRET = `knowledge-local-qa-${randomUUID()}`;
process.env.OPENAI_API_KEY = 'not-a-real-key-knowledge-qa-never-calls-ai';

require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { ValidationPipe, UnauthorizedException } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { KnowledgeModule } = require('../dist/knowledge/knowledge.module');
const { ClassificationService, CLASSIFICATION_QUEUE } = require('../dist/knowledge/classification.service');
const { ClassificationProcessor } = require('../dist/knowledge/classification.processor');
const { getQueueToken } = require('@nestjs/bullmq');
const { PrismaModule } = require('../dist/prisma/prisma.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');

const runId = randomUUID();
const createdUsers = [];
const actorsByToken = new Map();
const results = [];
let app;
let prisma;
let baseUrl;
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; });
process.once('SIGTERM', () => { interrupted = true; });

async function request(actor, path, method = 'GET', body, expected = 200) {
  if (interrupted) throw new Error('QA_INTERRUPTED');
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${method} ${path.split('?')[0]}: expected HTTP ${expected}, received ${response.status}`);
  return data;
}

async function scenario(name, check) {
  try {
    await check();
    results.push({ name, status: 'passed' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'failed' });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function createActor(label) {
  const user = await prisma.user.create({
    data: {
      email: `knowledge-qa-${runId}-${label}@example.invalid`,
      nickname: `Knowledge QA ${label}`,
      // Intentionally not a usable password hash; no account login is exercised.
      passwordHash: `not-a-login-hash-${randomUUID()}`,
    },
    select: { id: true, email: true },
  });
  createdUsers.push(user);
  const actor = { ...user, token: randomUUID() };
  actorsByToken.set(actor.token, user);
  return actor;
}

async function createArticle(actor, label) {
  const url = `https://www.threads.com/@readnest_qa/post/${runId}-${label}`;
  return prisma.savedArticle.create({
    data: {
      userId: actor.id,
      url,
      normalizedUrl: url,
      title: `QA ${label}`,
      rawText: 'PRIVATE_RAW_TEXT_MUST_NOT_APPEAR_IN_TOPIC_LIST',
      summary: 'PRIVATE_FULL_SUMMARY_MUST_NOT_APPEAR_IN_TOPIC_LIST',
      summaryMeta: { summaryMarkdown: 'PRIVATE_META_MUST_NOT_APPEAR_IN_TOPIC_LIST' },
      summaryPreview: '합성 자료 미리보기',
      processStatus: 'SUMMARY_DONE',
      generation: 1,
      resultGeneration: 1,
      generatedAt: new Date(),
    },
  });
}

const topicPath = (topic) => `/knowledge/topics/${typeof topic === 'string' ? topic : topic.id}`;
const linkPath = (topic, article) => `${topicPath(topic)}/articles/${article.id}`;
const articleTopicsPath = (article) => `/knowledge/articles/${article.id}/topics`;
const query = (values) => new URLSearchParams(values).toString();

async function createTopic(actor, name, description) {
  return request(actor, '/knowledge/topics', 'POST', { name, description }, 201);
}

function assertLightweight(article) {
  for (const field of ['rawText', 'summary', 'summaryMeta', 'keyPoints', 'lastSummaryError']) {
    assert.equal(Object.hasOwn(article, field), false, `list must not expose ${field}`);
  }
  assert.equal(JSON.stringify(article).includes('PRIVATE_'), false);
}

async function collectPages(actor, path, search = '') {
  const ids = [];
  let cursor;
  for (let page = 0; page < 100; page += 1) {
    const response = await request(actor, `${path}?${query({ limit: '1', search, ...(cursor ? { cursor } : {}) })}`);
    assert.ok(Array.isArray(response.items));
    assert.ok(response.items.length <= 1);
    ids.push(...response.items.map((item) => item.id));
    if (!response.nextCursor) {
      assert.equal(new Set(ids).size, ids.length, 'cursor pages must not repeat items');
      return ids;
    }
    assert.notEqual(response.nextCursor, cursor, 'cursor must advance');
    cursor = response.nextCursor;
  }
  assert.fail('pagination did not terminate');
}

async function main() {
  console.log('Local knowledge QA: synthetic authentication; no AI calls or background workers.');
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, KnowledgeModule],
  })
    .overrideProvider(getQueueToken(CLASSIFICATION_QUEUE)).useValue({ add: async () => {} })
    .overrideProvider(ClassificationService).useValue({})
    .overrideProvider(ClassificationProcessor).useValue({})
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const token = typeof req.headers.authorization === 'string'
          ? req.headers.authorization.replace(/^Bearer /, '')
          : '';
        const user = actorsByToken.get(token);
        if (!user) throw new UnauthorizedException();
        req.user = user;
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  // Match main.ts, including stripping unknown input rather than rejecting it.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  baseUrl = `${await app.getUrl()}/api`;
  prisma = app.get(PrismaService);

  const owner = await createActor('owner');
  const stranger = await createActor('stranger');
  const [articleA, articleB, articleC, foreignArticle] = await Promise.all([
    createArticle(owner, 'Alpha'),
    createArticle(owner, 'Beta'),
    createArticle(owner, 'Gamma'),
    createArticle(stranger, 'Foreign'),
  ]);
  let primary;
  let secondary;
  let foreignTopic;

  await scenario('topic create, Unicode normalization and owner-scoped duplicates', async () => {
    primary = await createTopic(owner, '  Cafe\u0301   AI  ', '  직접 작성한 설명  ');
    assert.equal(primary.name, 'Café AI');
    assert.equal(primary.description, '직접 작성한 설명');
    assert.equal(primary.articleCount, 0);
    assert.equal(primary.revision, 1);
    await request(owner, '/knowledge/topics', 'POST', { name: 'café ai' }, 409);
    await request(owner, '/knowledge/topics', 'POST', { name: 'Ｃａｆé ＡＩ' }, 409);
    foreignTopic = await createTopic(stranger, 'Café AI');
    assert.notEqual(foreignTopic.id, primary.id);
    secondary = await createTopic(owner, 'QA Secondary', '두 번째 주제');
  });

  await scenario('all routes require synthetic authentication', async () => {
    const routes = [
      ['GET', '/knowledge/topics'],
      ['POST', '/knowledge/topics', { name: 'Unauthorized' }],
      ['GET', topicPath(primary)],
      ['PATCH', topicPath(primary), { name: 'Unauthorized', expectedRevision: 1 }],
      ['DELETE', topicPath(primary)],
      ['GET', `${topicPath(primary)}/articles`],
      ['PUT', linkPath(primary, articleA)],
      ['DELETE', linkPath(primary, articleA)],
      ['GET', articleTopicsPath(articleA)],
    ];
    for (const [method, path, body] of routes) await request(null, path, method, body, 401);
  });

  await scenario('exact normalized codepoint limits and invalid query bounds', async () => {
    const bounded = await createTopic(owner, '🐍'.repeat(80), '🧭'.repeat(2000));
    assert.equal(Array.from(bounded.name).length, 80);
    assert.equal(Array.from(bounded.description).length, 2000);
    await request(owner, '/knowledge/topics', 'POST', { name: '🐍'.repeat(81) }, 400);
    await request(owner, '/knowledge/topics', 'POST', { name: 'Too much description', description: '🧭'.repeat(2001) }, 400);
    for (const name of ['', ' \t\n ', '\u200B', 'control\u0000name', null, 123]) {
      await request(owner, '/knowledge/topics', 'POST', { name }, 400);
    }
    const joinedEmoji = await createTopic(owner, '가족 👨‍👩‍👧‍👦');
    assert.equal(joinedEmoji.name, '가족 👨‍👩‍👧‍👦');
    await request(owner, topicPath(joinedEmoji), 'DELETE');
    await request(owner, topicPath(bounded), 'PATCH', { name: 'a'.repeat(81), expectedRevision: bounded.revision }, 400);
    await request(owner, topicPath(bounded), 'PATCH', { description: 'a'.repeat(2001), expectedRevision: bounded.revision }, 400);
    const paths = ['/knowledge/topics', `${topicPath(primary)}/articles`, articleTopicsPath(articleA)];
    for (const path of paths) {
      for (const limit of ['0', '-1', '101', '1.5', 'abc']) {
        await request(owner, `${path}?${query({ limit })}`, 'GET', undefined, 400);
      }
      await request(owner, `${path}?limit=100`);
      await request(owner, `${path}?${query({ search: 'a'.repeat(200) })}`);
      await request(owner, `${path}?${query({ search: 'a'.repeat(201) })}`, 'GET', undefined, 400);
    }
    await request(owner, topicPath(bounded), 'DELETE');
  });

  await scenario('topic edit, stale revision conflict and explicit description clearing', async () => {
    const updated = await request(owner, topicPath(primary), 'PATCH', {
      name: 'Café AI notes', description: '수정된 설명', expectedRevision: primary.revision,
    });
    assert.equal(updated.revision, primary.revision + 1);
    assert.equal(updated.name, 'Café AI notes');
    await request(owner, topicPath(primary), 'PATCH', { description: 'STALE', expectedRevision: primary.revision }, 409);
    await request(owner, topicPath(primary), 'PATCH', { name: secondary.name, expectedRevision: updated.revision }, 409);
    await request(owner, topicPath(primary), 'PATCH', { name: 'Missing revision' }, 400);
    const cleared = await request(owner, topicPath(primary), 'PATCH', { description: null, expectedRevision: updated.revision });
    assert.equal(cleared.description, null);
    assert.equal(cleared.name, updated.name);
    primary = cleared;
  });

  await scenario('all owner-isolation boundaries return 404 without mutating either owner', async () => {
    const foreignRoutes = [
      ['GET', topicPath(primary)],
      ['PATCH', topicPath(primary), { name: 'Stolen', expectedRevision: primary.revision }],
      ['DELETE', topicPath(primary)],
      ['GET', `${topicPath(primary)}/articles`],
      ['PUT', linkPath(primary, foreignArticle)],
      ['DELETE', linkPath(primary, foreignArticle)],
      ['GET', articleTopicsPath(articleA)],
    ];
    for (const [method, path, body] of foreignRoutes) await request(stranger, path, method, body, 404);
    await request(owner, linkPath(primary, foreignArticle), 'PUT', undefined, 404);
    await request(owner, linkPath(primary, foreignArticle), 'DELETE', undefined, 404);
    await request(owner, linkPath(foreignTopic, articleA), 'PUT', undefined, 404);
    await request(owner, topicPath(`missing-${runId}`), 'GET', undefined, 404);
    const current = await request(owner, topicPath(primary));
    assert.equal(current.revision, primary.revision);
    assert.equal(current.articleCount, 0);
    const ownerTopics = await request(owner, '/knowledge/topics');
    const strangerTopics = await request(stranger, '/knowledge/topics');
    assert.ok(ownerTopics.items.every((topic) => topic.id !== foreignTopic.id));
    assert.deepEqual(strangerTopics.items.map((topic) => topic.id), [foreignTopic.id]);
  });

  await scenario('PUT and DELETE are idempotent, with accurate counts and one revision per change', async () => {
    const before = await request(owner, topicPath(primary));
    await request(owner, linkPath(primary, articleA), 'PUT');
    const linked = await request(owner, topicPath(primary));
    assert.equal(linked.articleCount, 1);
    assert.equal(linked.revision, before.revision + 1);
    await request(owner, linkPath(primary, articleA), 'PUT');
    const replay = await request(owner, topicPath(primary));
    assert.equal(replay.articleCount, 1);
    assert.equal(replay.revision, linked.revision);
    await request(owner, linkPath(primary, articleA), 'DELETE');
    const unlinked = await request(owner, topicPath(primary));
    assert.equal(unlinked.articleCount, 0);
    assert.equal(unlinked.revision, linked.revision + 1);
    await request(owner, linkPath(primary, articleA), 'DELETE');
    const repeatDelete = await request(owner, topicPath(primary));
    assert.equal(repeatDelete.articleCount, 0);
    assert.equal(repeatDelete.revision, unlinked.revision);
  });

  await scenario('concurrent duplicate links create one membership and one revision', async () => {
    const before = await request(owner, topicPath(primary));
    await Promise.all(Array.from({ length: 5 }, () => request(owner, linkPath(primary, articleA), 'PUT')));
    const after = await request(owner, topicPath(primary));
    assert.equal(after.articleCount, 1);
    assert.equal(after.revision, before.revision + 1);
  });

  await scenario('one article can belong to multiple topics and survive re-query', async () => {
    await request(owner, linkPath(secondary, articleA), 'PUT');
    const topics = await request(owner, articleTopicsPath(articleA));
    assert.deepEqual(new Set(topics.items.map((topic) => topic.id)), new Set([primary.id, secondary.id]));
    await request(owner, linkPath(primary, articleB), 'PUT');
    await request(owner, linkPath(primary, articleC), 'PUT');
    assert.equal((await request(owner, topicPath(primary))).articleCount, 3);
  });

  await scenario('topic article pages are complete, lightweight and scoped to owner/topic/search', async () => {
    const path = `${topicPath(primary)}/articles`;
    const first = await request(owner, `${path}?limit=1`);
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);
    assertLightweight(first.items[0]);
    assert.deepEqual(new Set(await collectPages(owner, path)), new Set([articleA.id, articleB.id, articleC.id]));
    const all = await request(owner, path);
    all.items.forEach(assertLightweight);
    const searched = await request(owner, `${path}?search=Alpha`);
    assert.deepEqual(searched.items.map((article) => article.id), [articleA.id]);
    const encoded = query({ limit: '1', cursor: first.nextCursor });
    await request(stranger, `${topicPath(foreignTopic)}/articles?${encoded}`, 'GET', undefined, 400);
    await request(owner, `${topicPath(secondary)}/articles?${encoded}`, 'GET', undefined, 400);
    await request(owner, `${path}?${query({ limit: '1', cursor: first.nextCursor, search: 'Alpha' })}`, 'GET', undefined, 400);
    await request(owner, `${path}?cursor=not-a-valid-cursor`, 'GET', undefined, 400);
  });

  await scenario('topic and article-topic cursors reject wrong owner, search and endpoint scope', async () => {
    const first = await request(owner, '/knowledge/topics?limit=1');
    assert.ok(first.nextCursor);
    assert.deepEqual(new Set(await collectPages(owner, '/knowledge/topics')), new Set([primary.id, secondary.id]));
    await request(stranger, `/knowledge/topics?${query({ limit: '1', cursor: first.nextCursor })}`, 'GET', undefined, 400);
    await request(owner, `/knowledge/topics?${query({ limit: '1', cursor: first.nextCursor, search: 'AI' })}`, 'GET', undefined, 400);
    const articlePath = articleTopicsPath(articleA);
    const articleFirst = await request(owner, `${articlePath}?limit=1`);
    assert.ok(articleFirst.nextCursor);
    assert.deepEqual(new Set(await collectPages(owner, articlePath)), new Set([primary.id, secondary.id]));
    await request(owner, `${articleTopicsPath(articleB)}?${query({ cursor: articleFirst.nextCursor })}`, 'GET', undefined, 400);
    await request(owner, `${articlePath}?${query({ cursor: articleFirst.nextCursor, search: 'AI' })}`, 'GET', undefined, 400);
    await request(stranger, `${articleTopicsPath(foreignArticle)}?${query({ cursor: articleFirst.nextCursor })}`, 'GET', undefined, 400);
    await request(owner, `${articlePath}?${query({ cursor: first.nextCursor })}`, 'GET', undefined, 400);
  });

  await scenario('deleting a topic removes only its memberships, never saved articles', async () => {
    await request(owner, topicPath(secondary), 'DELETE');
    await request(owner, topicPath(secondary), 'GET', undefined, 404);
    const remaining = await prisma.savedArticle.findUnique({ where: { id: articleA.id }, select: { id: true, userId: true } });
    assert.equal(remaining?.userId, owner.id);
    const topics = await request(owner, articleTopicsPath(articleA));
    assert.deepEqual(topics.items.map((topic) => topic.id), [primary.id]);
    assert.equal((await request(owner, topicPath(primary))).articleCount, 3);
  });

  await scenario('database article deletion cascades memberships without deleting topics', async () => {
    // Article API is intentionally not imported: verify the actual FK cascade directly.
    await prisma.savedArticle.delete({ where: { id: articleA.id } });
    assert.equal((await request(owner, topicPath(primary))).articleCount, 2);
    const articles = await request(owner, `${topicPath(primary)}/articles`);
    assert.deepEqual(new Set(articles.items.map((article) => article.id)), new Set([articleB.id, articleC.id]));
    await request(owner, articleTopicsPath(articleA), 'GET', undefined, 404);
  });

  await scenario('topic operations never create summary jobs or variants', async () => {
    const where = { article: { userId: { in: createdUsers.map((user) => user.id) } } };
    assert.equal(await prisma.summaryTask.count({ where }), 0);
    assert.equal(await prisma.summaryVariant.count({ where }), 0);
  });
}

async function cleanup() {
  const failures = [];
  if (prisma) {
    for (const user of createdUsers) {
      try {
        // Exact identity plus known generated email: never delete by a broad QA prefix.
        const current = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
        if (current && current.email !== user.email) throw new Error('QA_CLEANUP_IDENTITY_MISMATCH');
        if (current) await prisma.user.delete({ where: { id: user.id } });
        assert.equal(await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } }), null);
      } catch {
        // These are synthetic IDs only; make manual recovery possible without secrets.
        failures.push(user.id);
      }
    }
  }
  if (app) await app.close();
  if (failures.length) {
    console.error(`CLEANUP FAILED for exact synthetic user IDs: ${failures.join(', ')}`);
    throw new Error('QA_CLEANUP_FAILED');
  }
  if (createdUsers.length) console.log(`CLEANUP removed ${createdUsers.length} synthetic users and their test-only rows.`);
}

(async () => {
  let success = false;
  try {
    await main();
    success = true;
  } catch (error) {
    // Do not print Prisma/network exception messages, which may contain connection data.
    console.error(`Knowledge QA stopped (${error?.code === 'ERR_ASSERTION' ? 'assertion failed' : 'setup or runtime error'}).`);
    if (error?.code === 'ERR_ASSERTION') console.error(error.message.split('\n')[0]);
  } finally {
    try { await cleanup(); } catch { success = false; }
  }
  console.log(JSON.stringify({
    syntheticAuthentication: true,
    actualJwtVerified: false,
    realDatabase: true,
    externalCalls: false,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    success,
  }, null, 2));
  process.exitCode = success ? 0 : 1;
})();
