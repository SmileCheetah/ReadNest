// Local integration + three paid synthetic classification calls. No user source or secrets printed.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
if (process.env.READNEST_CLASSIFICATION_QA !== '1') throw new Error('Set READNEST_CLASSIFICATION_QA=1 for local QA.');
require('dotenv').config({ quiet: true });
const database = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== '3307' || database.pathname !== '/readnest') throw new Error('Local readnest database only.');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { ClassificationService } = require('../dist/knowledge/classification.service');
const { QueueSafetyService } = require('../dist/queue/queue-safety.service');
const prisma = new PrismaClient();
const service = new ClassificationService(prisma, new ConfigService(), Object.assign(new EventEmitter(), { add: async () => {} }), new QueueSafetyService());
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const base = 'http://localhost:3001/api';
let owner;
async function http(path, token, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  return { status: response.status, value };
}
(async () => {
  owner = await prisma.user.create({ data: { email: `classification-qa-${randomUUID()}@example.invalid`, nickname: '분류 QA', passwordHash: 'not-a-login' } });
  const token = jwt.sign({ sub: owner.id, email: owner.email }, { expiresIn: '10m' });
  const foreignToken = jwt.sign({ sub: `foreign-${randomUUID()}`, email: 'foreign@example.invalid' }, { expiresIn: '10m' });
  const samples = [
    { title: '경제 테스트', raw: '기준금리 인하는 대출 이자 부담을 줄이지만 물가 상승 압력을 높일 수 있다. 가계는 변동금리 대출 비중과 상환 계획을 함께 점검해야 한다.', expected: 'ARTICLE', category: '경제·금융' },
    { title: '오픈소스 도구 테스트', raw: '오픈소스 프로젝트 NoteGarden을 소개합니다. 소스 코드를 공개하고 누구나 수정할 수 있습니다. 개인 메모를 Markdown 파일로 저장하고 문서 사이의 링크를 보여주는 지식 관리 도구입니다.', expected: 'OPEN_SOURCE', category: '생산성·지식 관리' },
    { title: '오픈소스 의견 테스트', raw: '오픈소스 생태계가 지속되려면 유지보수자의 노동에 보상이 필요하다. 기업이 무료 도구를 소비하는 데 그치지 말고 개발 비용을 분담해야 한다는 의견이다. 특정 프로젝트를 소개하는 글은 아니다.', expected: 'ARTICLE' },
  ];
  const ids = [];
  for (const sample of samples) {
    const started = Date.now();
    const article = await prisma.savedArticle.create({ data: { userId: owner.id, url: 'https://www.threads.com/@qa/post/' + randomUUID(), normalizedUrl: randomUUID(), title: sample.title, summaryPreview: sample.raw, rawText: sample.raw, processStatus: 'SUMMARY_DONE', resultGeneration: 1 } });
    ids.push(article.id);
    assert.equal((await http('/knowledge/classifications/scan', token, 'POST')).status, 201);
    let classified;
    while (Date.now() - started < 90_000) {
      classified = await prisma.articleClassification.findUnique({ where: { articleId: article.id } });
      if (classified && ['SUCCEEDED', 'FAILED'].includes(classified.state)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(classified?.state, 'SUCCEEDED');
    assert.equal(classified.kind, sample.expected);
    if (sample.category) assert.ok(classified.categories.includes(sample.category));
    console.log(JSON.stringify({ sample: sample.title, kind: classified.kind, categories: classified.categories, elapsedMs: Date.now() - started }));
  }
  const list = await http('/knowledge/classifications?kind=OPEN_SOURCE&category=' + encodeURIComponent('생산성·지식 관리'), token);
  assert.equal(list.status, 200); assert.equal(list.value.articles.length, 1); assert.equal(list.value.articles[0].id, ids[1]);
  assert.equal((await http('/knowledge/classifications?kind=ARTICLE', foreignToken)).value.articles.length, 0);
  assert.equal((await http('/knowledge/classifications/' + ids[0], foreignToken, 'PATCH', { kind: 'ARTICLE', categories: ['개발'], revision: 1 })).status, 404);
  assert.equal((await http('/knowledge/classifications/' + ids[0], token, 'PATCH', { kind: 'OPEN_SOURCE', categories: ['경제·금융'], revision: 1 })).status, 400);
  assert.equal((await http('/knowledge/classifications/' + ids[0], token, 'PATCH', { kind: 'ARTICLE', categories: ['개발'], revision: 2 })).status, 200);
  assert.equal(await service.schedule(ids[0]), false);
  assert.equal((await http('/knowledge/classifications/' + ids[0], token, 'PATCH', { kind: 'ARTICLE', categories: ['개발'], revision: 1 })).status, 409);
  const corrected = await prisma.articleClassification.findUnique({ where: { articleId: ids[0] } });
  assert.equal(corrected.userEdited, true);
  // Real DB completion and late-write guard; use deterministic output to avoid a fourth paid call.
  service.generate = async () => ({ kind: 'ARTICLE', categories: ['개발'], projectName: null, useCase: null, evidence: '근거' });
  await prisma.articleClassification.update({ where: { articleId: ids[2] }, data: { state: 'PENDING' } });
  await service.process({ articleId: ids[2], sourceGeneration: 1, revision: 2 });
  assert.equal((await prisma.articleClassification.findUnique({ where: { articleId: ids[2] } })).state, 'SUCCEEDED');
  console.log('PASS: HTTP dispatch → Redis queue → real Luna → MySQL completion; auth/isolation, filtering, validation, revision conflicts, manual override.');
})().catch(error => { console.error(JSON.stringify({ name: error.name, code: error.code, status: error.status, message: error.name === 'AssertionError' ? error.message : 'Classification QA failed; no credentials or source logged.' })); process.exitCode = 1; }).finally(async () => {
  if (owner) await prisma.user.delete({ where: { id: owner.id } });
  await prisma.$disconnect();
});
