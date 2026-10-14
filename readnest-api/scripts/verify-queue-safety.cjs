#!/usr/bin/env node
/**
 * Opt-in, local-only BullMQ demand/safety integration:
 *   node scripts/verify-queue-safety.cjs
 *   node scripts/verify-queue-safety.cjs --functional-only
 * Requires redis-server on PATH (or REDIS_SERVER_BINARY). No .env, production
 * application, database, AI API or existing Redis instance is loaded/contacted.
 * INFO counts include Lua internals and are NOT Upstash billable requests.
 * Full mode observes both startup and post-work idle for 125 seconds each.
 */
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

require('reflect-metadata');
require('ts-node').register({
  project: path.join(__dirname, '..', 'tsconfig.json'),
});
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { Test } = require('@nestjs/testing');
const { BullModule, Processor, getQueueToken } = require('@nestjs/bullmq');
const { QueueSafetyService } = require('../src/queue/queue-safety.service');
const {
  QUEUE_WORKER_OPTIONS,
  QuotaAwareWorkerHost,
} = require('../src/queue/quota-aware-worker.host');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quotaError = () =>
  new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500004.');
const observedClose = (worker) =>
  new Promise((resolve) => worker.once('closed', resolve));
const ownedWorkers = [];
const ownedQueues = [];
const ownedSafeties = [];
const functionalOnly = process.argv.includes('--functional-only');
let redisProcess;
let inspector;
let testModule;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeSafety() {
  const safety = new QueueSafetyService();
  ownedSafeties.push(safety);
  return safety;
}

async function bounded(promise, label, ms = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(predicate, label, ms = 25_000) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started >= ms)
      throw new Error(`${label}: timed out`);
    await sleep(25);
  }
}

async function unusedLoopbackPort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  return port;
}

async function startIsolatedRedis() {
  const port = await unusedLoopbackPort();
  redisProcess = spawn(
    process.env.REDIS_SERVER_BINARY || 'redis-server',
    [
      '--bind',
      '127.0.0.1',
      '--port',
      String(port),
      '--save',
      '',
      '--appendonly',
      'no',
      '--protected-mode',
      'yes',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await bounded(
    new Promise((resolve, reject) => {
      let output = '';
      redisProcess.once('error', reject);
      redisProcess.once('exit', (code) =>
        reject(new Error(`Isolated Redis exited: ${code}`)),
      );
      redisProcess.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.includes('Ready to accept connections')) resolve();
      });
      redisProcess.stderr.on('data', () => {});
    }),
    'Isolated Redis startup',
  );
  console.log(
    `[queue-safety] Dedicated ephemeral Redis started on 127.0.0.1:${port}`,
  );
  return { host: '127.0.0.1', port, maxRetriesPerRequest: null };
}

async function commandStats() {
  const info = await inspector.info('commandstats');
  return Object.fromEntries(
    info.split('\n').flatMap((line) => {
      const match = /^cmdstat_([^:]+):calls=(\d+),/.exec(line);
      return match ? [[match[1], Number(match[2])]] : [];
    }),
  );
}

function commandDelta(before, after) {
  const commands = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries(
    [...commands]
      .filter((name) => name !== 'info')
      .sort()
      .map((name) => [name, (after[name] || 0) - (before[name] || 0)])
      .filter(([, count]) => count !== 0),
  );
}

async function assertQuiet(label, durationMs) {
  const before = await commandStats();
  const started = performance.now();
  let remaining = durationMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 25_000);
    await sleep(chunk);
    remaining -= chunk;
    console.log(
      `[queue-safety] ${label}: ${Math.round((performance.now() - started) / 1000)} seconds observed`,
    );
  }
  const commands = commandDelta(before, await commandStats());
  assert.deepEqual(
    commands,
    {},
    `${label}: no worker/queue Redis commands while dormant`,
  );
  console.log(
    JSON.stringify({
      phase: label,
      elapsedMs: Math.round(performance.now() - started),
      commands,
    }),
  );
}

function completed(worker, jobId) {
  return new Promise((resolve, reject) => {
    const onComplete = (job) => {
      if (job.id !== jobId) return;
      cleanup();
      resolve();
    };
    const onFailed = (job, error) => {
      if (job?.id !== jobId) return;
      cleanup();
      reject(error);
    };
    function cleanup() {
      worker.off('completed', onComplete);
      worker.off('failed', onFailed);
    }
    worker.on('completed', onComplete);
    worker.on('failed', onFailed);
  });
}

function fixture(connection, name, safety, processor, options = {}) {
  const queue = new Queue(name, { connection });
  const worker = new Worker(
    name,
    (job) => safety.withProcessing(name, () => processor(job)),
    { connection, ...QUEUE_WORKER_OPTIONS, ...options },
  );
  ownedQueues.push(queue);
  ownedWorkers.push(worker);
  safety.watchQueue(queue);
  worker.on('error', (error) => safety.reportError(error));
  safety.startWorker(worker);
  return { queue, worker, safety };
}

async function closeFixture(items) {
  for (const safety of new Set(items.map((item) => item.safety)))
    safety.onModuleDestroy();
  await Promise.all(items.map(({ worker }) => worker.close(true)));
  await Promise.all(items.map(({ queue }) => queue.close()));
}

async function verifyDormancy(connection) {
  const safety = makeSafety();
  const starts = new Map();
  const hold = deferred();
  const items = [0, 1, 2].map((index) =>
    fixture(
      connection,
      `safety-demand-${index}`,
      safety,
      async (job) => {
        starts.set(job.id, performance.now());
        if (job.name === 'hold-active') await hold.promise;
        return { ok: true };
      },
      { concurrency: index === 2 ? 1 : 2 },
    ),
  );
  await bounded(
    Promise.all(
      items.flatMap(({ queue, worker }) => [
        queue.waitUntilReady(),
        worker.waitUntilReady(),
      ]),
    ),
    'Dormant readiness',
  );
  assert.ok(
    items.every(({ worker }) => !worker.isRunning()),
    'Workers must remain dormant without demand',
  );
  await sleep(500);
  await assertQuiet(
    'startup-idle-three-queues',
    functionalOnly ? 1_000 : 125_000,
  );
  const wakeMs = [];
  for (const [index, { queue, worker }] of items.entries()) {
    const id = `wake-${index}`;
    const done = completed(worker, id);
    const start = performance.now();
    await safety.enqueue(queue.name, () =>
      queue.add('wake', {}, { jobId: id }),
    );
    await bounded(done, 'Dormant worker wake', 5_000);
    const latency = starts.get(id) - start;
    assert.ok(
      latency < 5_000,
      'Demand must wake without waiting for idle timeout',
    );
    wakeMs.push(Math.round(latency));
  }
  console.log(
    JSON.stringify({ phase: 'demand-wakeup', enqueueToProcessMs: wakeMs }),
  );
  await until(
    () => items.every(({ worker }) => worker.isPaused()),
    'Post-work workers sleep',
  );
  await sleep(500);
  await assertQuiet(
    'post-work-idle-three-queues',
    functionalOnly ? 1_000 : 125_000,
  );
  return { safety, items, hold };
}

async function verifyPauseWakeRace(connection) {
  const safety = makeSafety();
  const item = fixture(
    connection,
    'safety-pause-race',
    safety,
    async () => {},
    { drainDelay: 1 },
  );
  const paused = deferred();
  const releasePause = deferred();
  const originalPause = item.worker.pause.bind(item.worker);
  item.worker.pause = async (...args) => {
    await originalPause(...args);
    paused.resolve();
    await releasePause.promise;
  };
  try {
    const first = completed(item.worker, 'before-pause');
    await safety.enqueue(item.queue.name, () =>
      item.queue.add('check', {}, { jobId: 'before-pause' }),
    );
    await bounded(first, 'Initial pause-race job');
    await bounded(paused.promise, 'Idle pause entered', 25_000);
    const raced = completed(item.worker, 'during-pause');
    await safety.enqueue(item.queue.name, () =>
      item.queue.add('check', {}, { jobId: 'during-pause' }),
    );
    releasePause.resolve();
    await bounded(raced, 'Demand during in-flight pause resumes worker', 5_000);
    console.log(
      JSON.stringify({
        phase: 'pause-wake-race',
        queuedDuringPauseCompleted: true,
      }),
    );
  } finally {
    releasePause.resolve();
    await closeFixture([item]);
  }
}

async function verifyActiveLockAndConcurrency(connection) {
  const safety = makeSafety();
  const first = deferred();
  const blocker = deferred();
  const prefetched = deferred();
  const firstStarted = deferred();
  const blockerStarted = deferred();
  const prefetchedStarted = deferred();
  const laterStarted = deferred();
  const activeEvents = new Set();
  const counts = new Map();
  let simultaneous = 0;
  let maxSimultaneous = 0;
  const item = fixture(
    connection,
    'safety-active-lock',
    safety,
    async (job) => {
      counts.set(job.id, (counts.get(job.id) || 0) + 1);
      simultaneous += 1;
      maxSimultaneous = Math.max(maxSimultaneous, simultaneous);
      if (job.id === 'first') {
        firstStarted.resolve();
        await first.promise;
      } else if (job.id === 'blocker') {
        blockerStarted.resolve();
        await blocker.promise;
      } else if (job.id === 'prefetched') {
        prefetchedStarted.resolve();
        await prefetched.promise;
      } else laterStarted.resolve();
      simultaneous -= 1;
    },
    {
      concurrency: 2,
      drainDelay: 1,
      stalledInterval: 1_000,
      lockDuration: 1_000,
      lockRenewTime: 250,
    },
  );
  item.worker.on('active', (job) => activeEvents.add(job.id));
  try {
    const initialDone = ['first', 'blocker', 'prefetched'].map((id) =>
      completed(item.worker, id),
    );
    await safety.enqueue(item.queue.name, () =>
      item.queue.addBulk(
        ['first', 'blocker', 'prefetched'].map((id) => ({
          name: 'check',
          data: {},
          opts: { jobId: id },
        })),
      ),
    );
    await bounded(
      Promise.all([firstStarted.promise, blockerStarted.promise]),
      'Both concurrency slots active',
    );
    first.resolve();
    await bounded(prefetchedStarted.promise, 'Job fetched by prior completion');
    assert.equal(
      activeEvents.has('prefetched'),
      false,
      'Fixture must exercise BullMQ completion-prefetch without active event',
    );
    blocker.resolve();
    await bounded(initialDone[1], 'Other active-event job finishes');
    console.log(
      '[queue-safety] Holding completion-prefetched job for 18 seconds across idle grace and short test lock renewals...',
    );
    await sleep(18_000);
    const lockTtlMs = await inspector.pttl(item.queue.toKey('prefetched:lock'));
    assert.ok(
      lockTtlMs > 0,
      'Idle sleep must not stop active job lock renewal',
    );
    assert.equal(
      item.worker.isPaused(),
      false,
      'A prefetched processor keeps unused concurrency awake',
    );
    const laterDone = completed(item.worker, 'later');
    await safety.enqueue(item.queue.name, () =>
      item.queue.add('check', {}, { jobId: 'later' }),
    );
    await bounded(
      laterStarted.promise,
      'Free slot starts job before prefetched job finishes',
      5_000,
    );
    prefetched.resolve();
    await bounded(Promise.all([...initialDone, laterDone]), 'All jobs finish');
    assert.equal(counts.size, 4);
    assert.ok(
      [...counts.values()].every((count) => count === 1),
      'No duplicate processing across pause/wake',
    );
    assert.equal(
      maxSimultaneous,
      2,
      'Configured concurrency and prefetched work remain usable',
    );
    console.log(
      JSON.stringify({
        phase: 'active-lock-and-concurrency',
        heldMs: 18_000,
        lockTtlMs,
        processedExactlyOnce: 4,
        maxSimultaneous,
        prefetchedJobHasActiveEvent: false,
        freeSlotProcessedBeforeLongJobFinished: true,
        shortenedTestLockDurationMs: 1_000,
      }),
    );
  } finally {
    first.resolve();
    blocker.resolve();
    prefetched.resolve();
    await closeFixture([item]);
  }
}

async function verifyStaleActiveRecovery(connection) {
  const name = 'safety-stale-active';
  const queue = new Queue(name, { connection });
  ownedQueues.push(queue);
  // Simulate a process disappearing while its Redis job is ACTIVE. The never-
  // resolved processor promise has no timer and does not keep Node alive.
  const oldWorker = new Worker(name, () => new Promise(() => {}), {
    connection,
    autorun: false,
    // Longer than the idle grace: recovery must keep running due to refreshed
    // durable demand, not merely finish before the first idle deadline.
    lockDuration: 18_000,
    stalledInterval: 250,
  });
  ownedWorkers.push(oldWorker);
  const active = once(oldWorker, 'active');
  oldWorker.on('error', () => {});
  void oldWorker.run().catch(() => {});
  await queue.add('check', {}, { jobId: 'stale-active' });
  await bounded(active, 'Old worker active before forced closure');
  await oldWorker.close(true);

  const safety = makeSafety();
  let recovered = 0;
  const worker = new Worker(
    name,
    () =>
      safety.withProcessing(name, async () => {
        recovered += 1;
      }),
    {
      connection,
      ...QUEUE_WORKER_OPTIONS,
      drainDelay: 1,
      lockDuration: 1_000,
      stalledInterval: 250,
    },
  );
  ownedWorkers.push(worker);
  worker.on('error', (error) => safety.reportError(error));
  const done = completed(worker, 'stale-active');
  safety.startWorker(worker);
  // This is the same demand signal made by the application DB dispatcher, not
  // a DB integration test. Refresh while durable pending work still exists.
  safety.wakeWorker(name);
  const recoveryStarted = performance.now();
  const demandTimer = setInterval(() => safety.wakeWorker(name), 100);
  try {
    await bounded(
      done,
      'Stalled ACTIVE job recovered while demand persists',
      25_000,
    );
    assert.equal(recovered, 1);
    const recoveryElapsedMs = Math.round(performance.now() - recoveryStarted);
    assert.ok(
      recoveryElapsedMs >= 15_000,
      'Fixture must outlast the idle grace',
    );
    console.log(
      JSON.stringify({
        phase: 'stale-active-recovery',
        recovered: 1,
        demandRefreshed: true,
        recoveryElapsedMs,
        orphanTestLockDurationMs: 18_000,
        shortenedTestStalledIntervalMs: 250,
        applicationDatabaseRecoveryTested: false,
      }),
    );
  } finally {
    clearInterval(demandTimer);
    safety.onModuleDestroy();
    await worker.close(true);
    await queue.close();
  }
}

async function verifyQuota(connection, { safety, items, hold }) {
  const active = once(items[0].worker, 'active');
  await safety.enqueue(items[0].queue.name, () =>
    items[0].queue.add('hold-active', {}, { jobId: 'hold-active' }),
  );
  await bounded(active, 'Active processor before quota');
  await Promise.all(items.map(({ queue }) => queue.pause()));
  for (const [index, { queue }] of items.entries()) {
    await safety.enqueue(queue.name, () =>
      queue.add('pending', {}, { jobId: `recover-${index}` }),
    );
    assert.equal((await queue.getJobCounts('paused')).paused, 1);
  }
  const closed = items.map(({ worker }) => observedClose(worker));
  items[0].worker.emit('error', quotaError());
  await bounded(Promise.all(closed), 'Quota closes active and dormant workers');
  assert.equal(safety.isQuotaBlocked, true);
  let enqueueCalls = 0;
  await assert.rejects(
    safety.enqueue(items[0].queue.name, async () => {
      enqueueCalls += 1;
    }),
    /REDIS_QUOTA_BLOCKED/,
  );
  items.forEach(({ queue }) => safety.wakeWorker(queue.name));
  assert.equal(enqueueCalls, 0);
  await assertQuiet('quota-latch-active-job-no-commands', 16_000);
  hold.resolve();

  const fresh = makeSafety();
  await Promise.all(items.map(({ queue }) => queue.resume()));
  const workers = items.map(({ queue }) => {
    const worker = new Worker(
      queue.name,
      () => fresh.withProcessing(queue.name, async () => {}),
      { connection, ...QUEUE_WORKER_OPTIONS },
    );
    ownedWorkers.push(worker);
    worker.on('error', (error) => fresh.reportError(error));
    return worker;
  });
  const recovered = workers.map((worker, index) =>
    completed(worker, `recover-${index}`),
  );
  workers.forEach((worker) => {
    // Recover persisted queue work after startup, before worker registration.
    fresh.wakeWorker(worker.name);
    fresh.startWorker(worker);
  });
  await bounded(Promise.all(recovered), 'Fresh process pending job recovery');
  assert.equal(fresh.isQuotaBlocked, false);
  console.log(
    JSON.stringify({
      phase: 'quota-recovery',
      closedWorkers: 3,
      blockedEnqueueCalls: enqueueCalls,
      previouslyWaitingJobsRecovered: 3,
      preRegistrationWakeRetained: true,
      applicationDatabaseRecoveryTested: false,
    }),
  );
  fresh.onModuleDestroy();
  await Promise.all(workers.map((worker) => worker.close(true)));
  await Promise.all(items.map(({ queue }) => queue.close()));
}

async function verifyNestLifecycle(connection) {
  const name = 'safety-nest-lifecycle';
  const safety = makeSafety();
  const processed = deferred();
  let bootstrapState;
  let processCount = 0;
  class LifecycleProcessor extends QuotaAwareWorkerHost {
    async processJob() {
      processCount += 1;
      processed.resolve();
    }
    onApplicationBootstrap() {
      bootstrapState = {
        wasRunning: this.worker.isRunning(),
        errorListeners: this.worker.listenerCount('error'),
      };
      super.onApplicationBootstrap();
    }
  }
  Processor(name, QUEUE_WORKER_OPTIONS)(LifecycleProcessor);
  const processor = new LifecycleProcessor(safety, name);
  testModule = await Test.createTestingModule({
    imports: [
      BullModule.forRoot({ connection }),
      BullModule.registerQueue({ name }),
    ],
    providers: [
      { provide: QueueSafetyService, useValue: safety },
      { provide: LifecycleProcessor, useValue: processor },
    ],
  }).compile();
  const queue = testModule.get(getQueueToken(name));
  await safety.enqueue(name, () =>
    queue.add('check', {}, { jobId: 'before-nest-bootstrap' }),
  );
  await testModule.init();
  assert.equal(
    bootstrapState.wasRunning,
    false,
    'Worker must not autorun before bootstrap',
  );
  assert.ok(
    bootstrapState.errorListeners > 0,
    'Inherited error listener exists before startup',
  );
  await bounded(
    processed.promise,
    'Successful enqueue before bootstrap retained its wake',
  );
  assert.equal(processCount, 1);
  const closed = observedClose(processor.worker);
  processor.worker.emit('error', quotaError());
  await bounded(closed, 'Inherited Nest error handler');
  assert.equal(safety.isQuotaBlocked, true);
  console.log(
    JSON.stringify({
      phase: 'nest-lifecycle',
      ...bootstrapState,
      preBootstrapJobProcessed: true,
      inheritedErrorHandlerClosedWorker: true,
    }),
  );
  await testModule.close();
  testModule = undefined;
}

async function run() {
  const connection = await startIsolatedRedis();
  inspector = new Redis({ ...connection, maxRetriesPerRequest: 1 });
  await bounded(inspector.ping(), 'Inspector readiness');
  const demand = await verifyDormancy(connection);
  // Other fixtures are closed before the quota quiet measurement below.
  await verifyPauseWakeRace(connection);
  await verifyActiveLockAndConcurrency(connection);
  await verifyStaleActiveRecovery(connection);
  await verifyQuota(connection, demand);
  await verifyNestLifecycle(connection);
  console.log(
    `[queue-safety] PASS (${functionalOnly ? 'short idle observations only' : 'two independent 125-second idle observations'}). Local Redis only; no Upstash, billing, API key or application database contacted.`,
  );
}

async function cleanup() {
  for (const safety of ownedSafeties) await safety.onModuleDestroy?.();
  await Promise.allSettled(ownedWorkers.map((worker) => worker.close(true)));
  await Promise.allSettled(ownedQueues.map((queue) => queue.close()));
  if (testModule) await testModule.close().catch(() => {});
  if (inspector) inspector.disconnect();
  if (redisProcess && redisProcess.exitCode === null && !redisProcess.killed) {
    const exited = once(redisProcess, 'exit');
    redisProcess.kill('SIGTERM');
    await bounded(exited, 'Owned Redis shutdown', 5_000).catch(() =>
      redisProcess.kill('SIGKILL'),
    );
  }
}

let interrupting = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (interrupting) return;
    interrupting = true;
    void cleanup().finally(() => process.exit(130));
  });
}
void run()
  .catch((error) => {
    console.error(`[queue-safety] FAIL: ${error.stack || error.message}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
