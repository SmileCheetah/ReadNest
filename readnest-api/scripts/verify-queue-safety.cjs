#!/usr/bin/env node
/**
 * Opt-in, local-only BullMQ safety smoke test:
 *   node scripts/verify-queue-safety.cjs
 *   node scripts/verify-queue-safety.cjs --functional-only
 * Requires redis-server on PATH (or REDIS_SERVER_BINARY). No .env, production
 * application, database, AI API or existing Redis instance is loaded/contacted.
 * INFO counts include commands executed inside Lua and are NOT Upstash billing.
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
const functionalOnly = process.argv.includes('--functional-only');
let redisProcess;
let inspector;
let testModule;

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

async function measureIdle(label, connection, options, safety) {
  const queues = [];
  const workers = [];
  const starts = new Map();
  let finishActive;
  const activeGate = new Promise((resolve) => {
    finishActive = resolve;
  });
  for (let index = 0; index < 3; index += 1) {
    const name = `safety-${label}-${index}`;
    const queue = new Queue(name, { connection });
    const worker = new Worker(
      name,
      async (job) => {
        starts.set(job.id, performance.now());
        if (job.name === 'hold-active') await activeGate;
        return { ok: true };
      },
      { connection, concurrency: index === 2 ? 1 : 2, ...options },
    );
    ownedQueues.push(queue);
    ownedWorkers.push(worker);
    queues.push(queue);
    workers.push(worker);
    worker.on('error', (error) => {
      if (safety) safety.reportError(error);
      else
        console.error(
          `[queue-safety] Unexpected baseline worker error: ${error.name}`,
        );
    });
    if (safety) {
      safety.watchQueue(queue);
      safety.startWorker(worker);
    }
  }
  await bounded(
    Promise.all([...queues, ...workers].map((item) => item.waitUntilReady())),
    `${label} readiness`,
  );
  await sleep(500);
  const before = await commandStats();
  const started = performance.now();
  console.log(
    `[queue-safety] ${functionalOnly ? 'Skipping idle measurement for' : 'Measuring 125 seconds of idle workers:'} ${label}`,
  );
  for (const duration of functionalOnly
    ? []
    : [25_000, 25_000, 25_000, 25_000, 25_000]) {
    await sleep(duration);
    console.log(
      `[queue-safety] ${label} idle elapsed: ${Math.round((performance.now() - started) / 1000)} seconds`,
    );
  }
  const elapsedMs = performance.now() - started;
  const commands = commandDelta(before, await commandStats());
  console.log(
    JSON.stringify({
      phase: `${label}-idle`,
      elapsedMs: Math.round(elapsedMs),
      commands,
    }),
  );
  return { queues, workers, starts, commands, elapsedMs, finishActive };
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

async function verifyNestLifecycle(connection) {
  const name = 'safety-nest-lifecycle';
  const safety = new QueueSafetyService();
  let processed = 0;
  let bootstrapState;
  class LifecycleProcessor extends QuotaAwareWorkerHost {
    async process() {
      processed += 1;
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
  const processor = new LifecycleProcessor(safety);
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
  await testModule.init();
  assert.equal(
    bootstrapState.wasRunning,
    false,
    'Worker must not autorun before bootstrap',
  );
  assert.ok(
    bootstrapState.errorListeners > 0,
    'Inherited error listener must exist before startup',
  );
  const queue = testModule.get(getQueueToken(name));
  const done = completed(processor.worker, 'nest-bootstrap-job');
  await queue.add('check', {}, { jobId: 'nest-bootstrap-job' });
  await bounded(done, 'Nest bootstrap job');
  assert.equal(processed, 1);
  const closed = observedClose(processor.worker);
  processor.worker.emit('error', quotaError());
  await bounded(closed, 'Inherited Nest error handler');
  assert.equal(safety.isQuotaBlocked, true);
  console.log(
    JSON.stringify({
      phase: 'nest-lifecycle',
      ...bootstrapState,
      processed,
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
  const baseline = await measureIdle('defaults', connection, {}, undefined);
  await Promise.all(baseline.workers.map((worker) => worker.close(true)));
  await Promise.all(baseline.queues.map((queue) => queue.close()));

  const safety = new QueueSafetyService();
  const tuned = await measureIdle(
    'tuned',
    connection,
    QUEUE_WORKER_OPTIONS,
    safety,
  );
  if (!functionalOnly) {
    assert.ok(
      (baseline.commands.evalsha || 0) > (tuned.commands.evalsha || 0),
      'Idle Lua calls must decrease',
    );
    assert.ok(
      (baseline.commands.bzpopmin || 0) > (tuned.commands.bzpopmin || 0),
      'Idle blocking-pop completions must decrease',
    );
    console.log(
      '[queue-safety] Note: 125 seconds captures multiple 60-second blocking waits and a 120-second stalled check. INFO counts include Lua internals and are not Upstash billable requests.',
    );
  }

  const wakeMs = [];
  for (let index = 0; index < 3; index += 1) {
    const jobId = `wake-${index}`;
    const done = completed(tuned.workers[index], jobId);
    const start = performance.now();
    await safety.enqueue(() => tuned.queues[index].add('wake', {}, { jobId }));
    await bounded(done, 'Immediate wake', 5_000);
    const latency = tuned.starts.get(jobId) - start;
    assert.ok(
      latency < 5_000,
      'New jobs should not wait for the 60-second timeout',
    );
    wakeMs.push(Math.round(latency));
  }
  console.log(
    JSON.stringify({ phase: 'blocking-wakeup', enqueueToProcessMs: wakeMs }),
  );

  // Keep one processor active, then pause only these dedicated test queues so
  // prefetched fetch loops cannot consume our pending fixtures before quota.
  // No durable application DB is involved.
  const active = new Promise((resolve) => {
    tuned.workers[0].once('active', resolve);
  });
  await safety.enqueue(() =>
    tuned.queues[0].add('hold-active', {}, { jobId: 'hold-active' }),
  );
  await bounded(active, 'Active processor before quota');
  await Promise.all(tuned.queues.map((queue) => queue.pause()));
  for (let index = 0; index < 3; index += 1) {
    await safety.enqueue(() =>
      tuned.queues[index].add('pending', {}, { jobId: `recover-${index}` }),
    );
    assert.equal((await tuned.queues[index].getJobCounts('paused')).paused, 1);
  }
  const closed = tuned.workers.map(observedClose);
  tuned.workers[0].emit('error', quotaError());
  await bounded(Promise.all(closed), 'Quota closure of all workers');
  assert.equal(safety.isQuotaBlocked, true);
  let enqueueCalls = 0;
  await assert.rejects(
    safety.enqueue(async () => {
      enqueueCalls += 1;
    }),
    /REDIS_QUOTA_BLOCKED/,
  );
  assert.equal(enqueueCalls, 0, 'Blocked guard must not invoke Redis enqueue');
  const beforeBlocked = await commandStats();
  console.log(
    '[queue-safety] Waiting 16 seconds after closure, including the active job lock-renewal interval...',
  );
  await sleep(16_000);
  const afterBlocked = commandDelta(beforeBlocked, await commandStats());
  assert.deepEqual(
    afterBlocked,
    {},
    'Closed workers must make no continued Redis commands',
  );
  console.log(
    JSON.stringify({
      phase: 'quota-latch',
      closedWorkers: 3,
      blockedEnqueueCalls: enqueueCalls,
      commandsAfterCloseOver16000ms: afterBlocked,
      includedActiveJob: true,
    }),
  );
  tuned.finishActive();

  const recoveredSafety = new QueueSafetyService();
  await Promise.all(tuned.queues.map((queue) => queue.resume()));
  const recoveredWorkers = tuned.queues.map((queue) => {
    const worker = new Worker(queue.name, async () => ({ recovered: true }), {
      connection,
      ...QUEUE_WORKER_OPTIONS,
    });
    ownedWorkers.push(worker);
    worker.on('error', (error) => recoveredSafety.reportError(error));
    return worker;
  });
  const recovered = recoveredWorkers.map((worker, index) =>
    completed(worker, `recover-${index}`),
  );
  recoveredWorkers.forEach((worker) => recoveredSafety.startWorker(worker));
  await bounded(Promise.all(recovered), 'Fresh service pending job recovery');
  assert.equal(recoveredSafety.isQuotaBlocked, false);
  console.log(
    JSON.stringify({
      phase: 'fresh-process-simulation',
      previouslyWaitingJobsRecovered: 3,
      applicationDatabaseRecoveryTested: false,
    }),
  );
  await Promise.all(recoveredWorkers.map((worker) => worker.close(true)));
  await verifyNestLifecycle(connection);
  console.log(
    '[queue-safety] PASS. Local functional verification only; no Upstash, billing, API key or application database was contacted.',
  );
}

async function cleanup() {
  await Promise.allSettled(ownedWorkers.map((worker) => worker.close(true)));
  await Promise.allSettled(ownedQueues.map((queue) => queue.close()));
  if (testModule) await testModule.close().catch(() => {});
  if (inspector) inspector.disconnect();
  if (redisProcess && redisProcess.exitCode === null && !redisProcess.killed) {
    const exited = once(redisProcess, 'exit');
    redisProcess.kill('SIGTERM');
    await bounded(exited, 'Owned Redis shutdown', 5_000).catch(() => {
      redisProcess.kill('SIGKILL');
    });
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
