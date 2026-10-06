import { developmentWebCors } from './development-web-cors';

describe('local Expo web CORS', () => {
  it('allows only the two local Expo origins in development', () => {
    expect(developmentWebCors('development')).toEqual({
      origin: ['http://localhost:8081', 'http://127.0.0.1:8081'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      credentials: false,
    });
  });
  it.each(['production', 'test', undefined])(
    'does not enable dev CORS in %s',
    (env) => {
      expect(developmentWebCors(env)).toBeUndefined();
    },
  );
});
