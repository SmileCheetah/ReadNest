type RuntimeEnvCheck = {
  missing: string[];
  warnings: string[];
};

const VALID_NODE_ENVS = new Set(['development', 'test', 'production']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const DEV_JWT_SECRETS = new Set([
  'dev-readnest-jwt-secret',
  'change-me-readnest-dev-secret',
]);

function hasValue(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function normalizeEnvValue(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function normalizeNodeEnv(check: RuntimeEnvCheck) {
  const nodeEnv = process.env.NODE_ENV;

  if (!hasValue(nodeEnv)) {
    process.env.NODE_ENV = 'production';
    check.warnings.push(
      'NODE_ENV was missing and defaulted to production for deployment runtime.',
    );
    return;
  }

  const normalizedNodeEnv = normalizeEnvValue(nodeEnv as string);

  if (normalizedNodeEnv !== nodeEnv) {
    process.env.NODE_ENV = normalizedNodeEnv;
    check.warnings.push('NODE_ENV was normalized.');
  }
}

function getUrlHostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getHostname(value: string) {
  return value.trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isLocalHostname(hostname: string | null) {
  return hostname ? LOCAL_HOSTNAMES.has(hostname) : false;
}

function buildDatabaseUrlFromParts() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

  if (![DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD].every(hasValue)) {
    return null;
  }

  const user = encodeURIComponent(DB_USER as string);
  const password = encodeURIComponent(DB_PASSWORD as string);
  const host = DB_HOST as string;
  const port = DB_PORT as string;
  const database = encodeURIComponent(DB_NAME as string);

  return `mysql://${user}:${password}@${host}:${port}/${database}`;
}

function normalizePrismaMysqlUrl(databaseUrl: string) {
  const trimmed = databaseUrl.trim();

  if (trimmed.startsWith('mysql://')) {
    return trimmed;
  }

  if (trimmed.startsWith('mysql+pymysql://')) {
    return trimmed.replace(/^mysql\+pymysql:\/\//, 'mysql://');
  }

  return null;
}

function validateNodeEnv(check: RuntimeEnvCheck) {
  normalizeNodeEnv(check);

  if (!VALID_NODE_ENVS.has(process.env.NODE_ENV as string)) {
    check.missing.push('NODE_ENV must be development, test, or production');
  }
}

function validatePort(check: RuntimeEnvCheck) {
  if (!hasValue(process.env.PORT)) return;

  const port = Number(process.env.PORT);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    check.missing.push('PORT must be a valid TCP port number');
  }
}

function validateDatabase(check: RuntimeEnvCheck) {
  const configuredDatabaseUrl = process.env.DATABASE_URL;

  if (hasValue(configuredDatabaseUrl)) {
    const normalizedDatabaseUrl = normalizePrismaMysqlUrl(
      configuredDatabaseUrl as string,
    );

    if (normalizedDatabaseUrl) {
      process.env.DATABASE_URL = normalizedDatabaseUrl;

      if (normalizedDatabaseUrl !== configuredDatabaseUrl?.trim()) {
        check.warnings.push(
          'DATABASE_URL was normalized to a Prisma-compatible mysql:// URL.',
        );
      }
    } else {
      const databaseUrlFromParts = buildDatabaseUrlFromParts();

      if (databaseUrlFromParts) {
        process.env.DATABASE_URL = databaseUrlFromParts;
        check.warnings.push(
          'DATABASE_URL was not Prisma-compatible. It was rebuilt from DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.',
        );
      } else {
        check.missing.push(
          'DATABASE_URL must use mysql://, or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD must be set',
        );
        return;
      }
    }
  } else {
    const databaseUrlFromParts = buildDatabaseUrlFromParts();

    if (databaseUrlFromParts) {
      process.env.DATABASE_URL = databaseUrlFromParts;
      check.warnings.push(
        'DATABASE_URL was built from DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.',
      );
    } else {
      check.missing.push(
        'DATABASE_URL or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD',
      );
      return;
    }
  }

  if (
    isProduction() &&
    isLocalHostname(getUrlHostname(process.env.DATABASE_URL as string))
  ) {
    check.missing.push(
      'DATABASE_URL must not point to localhost in production',
    );
  }
}

function validateJwt(check: RuntimeEnvCheck) {
  const secret = process.env.JWT_SECRET;

  if (!hasValue(secret)) {
    check.missing.push('JWT_SECRET');
    return;
  }

  if (!isProduction()) return;

  if ((secret as string).length < 32 || DEV_JWT_SECRETS.has(secret as string)) {
    check.missing.push(
      'JWT_SECRET must be a strong production secret with at least 32 characters',
    );
  }
}

function validateRedis(check: RuntimeEnvCheck) {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;

  if (hasValue(redisUrl)) {
    const hostname = getUrlHostname(redisUrl as string);

    if (!hostname) {
      check.missing.push('REDIS_URL must be a valid redis:// or rediss:// URL');
      return;
    }

    if (isProduction() && isLocalHostname(hostname)) {
      check.missing.push('REDIS_URL must not point to localhost in production');
    }

    return;
  }

  if (!isProduction()) return;

  if (!hasValue(redisHost)) {
    check.missing.push('REDIS_URL or REDIS_HOST');
    return;
  }

  if (isLocalHostname(getHostname(redisHost as string))) {
    check.missing.push('REDIS_HOST must not point to localhost in production');
  }
}

function validateGemini(check: RuntimeEnvCheck) {
  if (hasValue(process.env.GEMINI_API_KEY)) return;

  if (isProduction()) {
    check.missing.push('GEMINI_API_KEY');
    return;
  }

  check.warnings.push(
    'GEMINI_API_KEY is empty. The API will use fallback summaries.',
  );
}

export function validateRuntimeEnv() {
  const check: RuntimeEnvCheck = {
    missing: [],
    warnings: [],
  };

  validateNodeEnv(check);
  validateDatabase(check);
  validateJwt(check);
  validatePort(check);
  validateRedis(check);
  validateGemini(check);

  if (check.warnings.length) {
    for (const warning of check.warnings) {
      console.warn(`[env] ${warning}`);
    }
  }

  if (check.missing.length) {
    console.error('[env] ReadNest API cannot start.');
    console.error(
      `[env] Missing or invalid environment variables: ${check.missing.join(
        ', ',
      )}`,
    );
    console.error(
      '[env] Configure KoDeploy environment variables before redeploying.',
    );

    throw new Error('Invalid ReadNest API runtime environment');
  }
}
