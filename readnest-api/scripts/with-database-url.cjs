#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

if (process.env.READNEST_SKIP_DOTENV !== 'true') {
  require('dotenv').config({ quiet: true });
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildDatabaseUrlFromParts() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

  if (![DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD].every(hasValue)) {
    return null;
  }

  const user = encodeURIComponent(DB_USER);
  const password = encodeURIComponent(DB_PASSWORD);
  const database = encodeURIComponent(DB_NAME);

  return `mysql://${user}:${password}@${DB_HOST}:${DB_PORT}/${database}`;
}

function normalizePrismaMysqlUrl(databaseUrl) {
  const trimmed = databaseUrl.trim();

  if (trimmed.startsWith('mysql://')) {
    return trimmed;
  }

  if (trimmed.startsWith('mysql+pymysql://')) {
    return trimmed.replace(/^mysql\+pymysql:\/\//, 'mysql://');
  }

  return null;
}

function ensureDatabaseUrl() {
  if (hasValue(process.env.DATABASE_URL)) {
    const configuredDatabaseUrl = process.env.DATABASE_URL;
    const normalizedDatabaseUrl = normalizePrismaMysqlUrl(
      configuredDatabaseUrl,
    );

    if (normalizedDatabaseUrl) {
      process.env.DATABASE_URL = normalizedDatabaseUrl;

      if (normalizedDatabaseUrl !== configuredDatabaseUrl.trim()) {
        console.warn(
          '[env] DATABASE_URL was normalized to a Prisma-compatible mysql:// URL.',
        );
      }

      return;
    }
  }

  const databaseUrl = buildDatabaseUrlFromParts();

  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
    console.warn(
      '[env] DATABASE_URL was built from DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.',
    );
    return;
  }

  const isPrismaGenerate =
    process.argv[2] === 'prisma' && process.argv[3] === 'generate';

  if (isPrismaGenerate) {
    process.env.DATABASE_URL =
      'mysql://placeholder:placeholder@localhost:3306/placeholder';
    console.warn(
      '[env] DATABASE_URL is missing. Using a placeholder for prisma generate only.',
    );
    return;
  }

  console.error('[env] Prisma command cannot run.');
  console.error(
    '[env] Missing DATABASE_URL or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.',
  );
  process.exit(1);
}

ensureDatabaseUrl();

const [, , command, ...args] = process.argv;

if (!command) {
  console.error(
    'Usage: node scripts/with-database-url.cjs <command> [...args]',
  );
  process.exit(1);
}

function resolveCommand(commandName) {
  const executable =
    process.platform === 'win32' ? `${commandName}.cmd` : commandName;
  const localBin = join(__dirname, '..', 'node_modules', '.bin', executable);

  return existsSync(localBin) ? localBin : commandName;
}

const result = spawnSync(resolveCommand(command), args, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
