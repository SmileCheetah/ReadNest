import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { THREADS_HOSTS } from '../articles/utils/normalize-url';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export type SourceBudget = { remainingBytes: number; deadline: number };

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6) {
    // Only native global-unicast IPv6; reject mapped, local, transition and docs ranges.
    const lower = address.toLowerCase();
    const second = Number.parseInt(lower.split(':')[1] || '0', 16);
    return (
      /^[23][0-9a-f]{3}:/.test(lower) &&
      !lower.startsWith('2002:') &&
      !(lower.startsWith('2001:') && (second < 0x200 || second === 0xdb8)) &&
      !lower.startsWith('3fff:')
    );
  }
  return false;
}

export function validateSourceUrl(value: string, subresource = false): URL {
  const url = new URL(value);
  const host = url.hostname;
  const cdn =
    subresource &&
    ['cdninstagram.com', 'fbcdn.net', 'instagram.com'].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    (!THREADS_HOSTS.has(host) && !cdn)
  )
    throw new Error('UNSAFE_SOURCE_URL');
  return url;
}

export async function resolvePublicSource(host: string) {
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw new Error('UNSAFE_SOURCE_ADDRESS');
  }
  return addresses[0];
}

/** Every connection pins a checked DNS answer; TLS still verifies the original hostname. */
export async function safeSourceRequest(
  value: string,
  options: {
    budget: SourceBudget;
    subresource?: boolean;
    method?: 'GET' | 'POST';
    body?: string;
    contentType?: string;
    redirects?: number;
  },
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const url = validateSourceUrl(value, options.subresource);
  if (options.body && Buffer.byteLength(options.body) > 65536)
    throw new Error('SOURCE_REQUEST_TOO_LARGE');
  if (
    options.budget.remainingBytes <= 0 ||
    Date.now() >= options.budget.deadline
  )
    throw new Error('SOURCE_BUDGET_EXHAUSTED');
  const timeoutMs = Math.min(8000, options.budget.deadline - Date.now());
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const address = await Promise.race([
    resolvePublicSource(url.hostname),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(
        () => reject(new Error('SOURCE_DNS_TIMEOUT')),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (dnsTimer) clearTimeout(dnsTimer);
  });
  const response = await new Promise<{
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const req = request(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 ReadNest/1.0',
          Accept: 'text/html,application/json,*/*',
          'Accept-Encoding': 'identity',
          ...(options.contentType
            ? { 'Content-Type': options.contentType }
            : {}),
        },
        lookup: (_host, _opts, callback) =>
          callback(null, address.address, address.family),
        family: address.family,
        servername: url.hostname,
      },
      (res) => {
        if (
          res.headers['content-encoding'] &&
          res.headers['content-encoding'] !== 'identity'
        ) {
          req.destroy(new Error('SOURCE_ENCODING_UNSUPPORTED'));
          return;
        }
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          options.budget.remainingBytes -= chunk.length;
          if (bytes > MAX_RESPONSE_BYTES || options.budget.remainingBytes < 0) {
            req.destroy(new Error('SOURCE_RESPONSE_TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [key, val] of Object.entries(res.headers)) {
            if (
              typeof val === 'string' &&
              ![
                'transfer-encoding',
                'content-encoding',
                'content-length',
                'connection',
                'set-cookie',
              ].includes(key)
            )
              headers[key] = val;
          }
          resolve({
            status: res.statusCode ?? 502,
            headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error('SOURCE_TIMEOUT')),
      Math.max(1, Math.min(timeoutMs, options.budget.deadline - Date.now())),
    );
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if ((options.redirects ?? 0) >= 3 || !response.headers.location)
      throw new Error('SOURCE_REDIRECT_LIMIT');
    const next = new URL(response.headers.location, url).toString();
    // Each redirect is allowlisted, resolved and pinned again.
    return safeSourceRequest(next, {
      ...options,
      method: response.status === 303 ? 'GET' : options.method,
      body: response.status === 303 ? undefined : options.body,
      redirects: (options.redirects ?? 0) + 1,
    });
  }
  return response;
}
