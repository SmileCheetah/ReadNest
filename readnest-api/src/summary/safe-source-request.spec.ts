import { EventEmitter } from 'node:events';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { safeSourceRequest } from './safe-source-http';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));

type ResponseFixture = {
  status: number;
  headers?: Record<string, string>;
  chunks?: Buffer[];
};
function serve(fixtures: ResponseFixture[]) {
  jest
    .mocked(lookup)
    .mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as never);
  jest.mocked(request).mockImplementation(((
    _url: URL,
    _options: unknown,
    callback: (response: EventEmitter) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & {
      destroy: (error: Error) => void;
      write: () => void;
      end: () => void;
    };
    req.destroy = (error) => {
      req.emit('error', error);
      req.emit('close');
    };
    req.write = () => undefined;
    req.end = () => {
      setImmediate(() => {
        const fixture = fixtures.shift();
        if (!fixture) throw new Error('Missing mock response');
        const response = Object.assign(new EventEmitter(), {
          statusCode: fixture.status,
          headers: fixture.headers ?? {},
        });
        callback(response);
        for (const chunk of fixture.chunks ?? []) response.emit('data', chunk);
        response.emit('end');
        req.emit('close');
      });
    };
    return req;
  }) as never);
}

describe('bounded source HTTP', () => {
  beforeEach(() => jest.resetAllMocks());
  const options = () => ({
    budget: { remainingBytes: 8 * 1024 * 1024, deadline: Date.now() + 1000 },
  });
  it('validates each redirect before connecting and refuses private destinations', async () => {
    serve([
      {
        status: 302,
        headers: { location: 'https://169.254.169.254/latest/meta-data' },
      },
    ]);
    await expect(
      safeSourceRequest('https://threads.com/@a/post/b', options()),
    ).rejects.toThrow('UNSAFE_SOURCE_URL');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('resolves and pins every redirect connection while retaining TLS hostname', async () => {
    serve([
      {
        status: 302,
        headers: { location: 'https://www.threads.com/@a/post/b' },
      },
      { status: 200, chunks: [Buffer.from('body')] },
    ]);
    const response = await safeSourceRequest(
      'https://threads.com/@a/post/b',
      options(),
    );
    expect(response.body.toString()).toBe('body');
    expect(lookup).toHaveBeenCalledTimes(2);
    const call = jest.mocked(request).mock.calls[1] as unknown as [
      URL,
      {
        servername: string;
        family: number;
        lookup: (
          host: string,
          opts: unknown,
          callback: (error: null, ip: string, family: number) => void,
        ) => void;
      },
    ];
    expect(call[1].servername).toBe('www.threads.com');
    const callback = jest.fn();
    call[1].lookup('www.threads.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '1.1.1.1', 4);
  });
  it('limits response size and shared aggregate bytes', async () => {
    serve([{ status: 200, chunks: [Buffer.alloc(2 * 1024 * 1024 + 1)] }]);
    await expect(
      safeSourceRequest('https://threads.com/x', options()),
    ).rejects.toThrow('SOURCE_RESPONSE_TOO_LARGE');
    serve([{ status: 200, chunks: [Buffer.alloc(50)] }]);
    await expect(
      safeSourceRequest('https://threads.com/x', {
        budget: { remainingBytes: 40, deadline: Date.now() + 1000 },
      }),
    ).rejects.toThrow('SOURCE_RESPONSE_TOO_LARGE');
  });
  it('rejects compressed responses and exhausted deadlines', async () => {
    serve([{ status: 200, headers: { 'content-encoding': 'gzip' } }]);
    await expect(
      safeSourceRequest('https://threads.com/x', options()),
    ).rejects.toThrow('SOURCE_ENCODING_UNSUPPORTED');
    await expect(
      safeSourceRequest('https://threads.com/x', {
        budget: { remainingBytes: 1024, deadline: Date.now() - 1 },
      }),
    ).rejects.toThrow('SOURCE_BUDGET_EXHAUSTED');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
