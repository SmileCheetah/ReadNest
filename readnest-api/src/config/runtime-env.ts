type RuntimeEnvCheck = {
  missing: string[];
  warnings: string[];
};

function hasValue(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildDatabaseUrlFromParts() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

  if (![DB_HOST, DB_NAME, DB_USER, DB_PASSWORD].every(hasValue)) {
    return null;
  }

  const user = encodeURIComponent(DB_USER as string);
  const password = encodeURIComponent(DB_PASSWORD as string);
  const host = DB_HOST as string;
  const port = hasValue(DB_PORT) ? `:${DB_PORT}` : '';
  const database = encodeURIComponent(DB_NAME as string);

  return `mysql://${user}:${password}@${host}${port}/${database}`;
}

function validatePort(check: RuntimeEnvCheck) {
  if (!hasValue(process.env.PORT)) return;

  const port = Number(process.env.PORT);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    check.missing.push('PORT must be a valid TCP port number');
  }
}

export function validateRuntimeEnv() {
  const check: RuntimeEnvCheck = {
    missing: [],
    warnings: [],
  };

  if (!hasValue(process.env.DATABASE_URL)) {
    const databaseUrl = buildDatabaseUrlFromParts();

    if (databaseUrl) {
      process.env.DATABASE_URL = databaseUrl;
      check.warnings.push(
        'DATABASE_URL was built from DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.',
      );
    } else {
      check.missing.push(
        'DATABASE_URL or DB_HOST, DB_NAME, DB_USER, DB_PASSWORD',
      );
    }
  }

  if (!hasValue(process.env.JWT_SECRET)) {
    check.missing.push('JWT_SECRET');
  }

  validatePort(check);

  if (!hasValue(process.env.GEMINI_API_KEY)) {
    check.warnings.push(
      'GEMINI_API_KEY is empty. The API will use fallback summaries.',
    );
  }

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
