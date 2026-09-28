import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** Expo web needs cross-origin access; production must not inherit this dev allowance. */
export function developmentWebCors(
  nodeEnv: string | undefined,
): CorsOptions | undefined {
  if (nodeEnv !== 'development') return undefined;
  return {
    origin: ['http://localhost:8081', 'http://127.0.0.1:8081'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: false,
  };
}
