#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

if (!process.env.NODE_ENV || process.env.NODE_ENV.trim().length === 0) {
  process.env.NODE_ENV = 'production';
}

console.log('[db] Applying pending Prisma migrations...');

const migrationResult = spawnSync(
  process.execPath,
  [join(__dirname, 'with-database-url.cjs'), 'prisma', 'migrate', 'deploy'],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

if (migrationResult.error) {
  console.error(
    `[db] Failed to run Prisma migrations: ${migrationResult.error.message}`,
  );
  process.exit(1);
}

if (migrationResult.status !== 0) {
  console.error('[db] Prisma migrations failed. API startup aborted.');
  process.exit(migrationResult.status ?? 1);
}

console.log('[db] Prisma migrations are up to date.');

require('../dist/main.js');
