import { parseThreadsUrl } from '../articles/utils/normalize-url';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const string = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export type ThreadsSource = {
  text: string;
  partCount: number;
  sourceCompleteness: 'UNKNOWN' | 'PARTIAL';
};

/** Parse data, never execute scripts. Only result.data.media belongs to this page;
 * relatedPosts, quoted posts and arbitrary same-author comments are not continuations. */
export function extractThreadsSource(
  html: string,
  url: string,
  limit: number,
): ThreadsSource | null {
  const requested = new URL(parseThreadsUrl(url).canonical).pathname.split('/');
  const author = decodeURIComponent(requested[1])
    .replace(/^@/, '')
    .toLowerCase();
  const code = requested[3];
  const media: JsonObject[] = [];
  let visited = 0;
  const walk = (value: unknown, depth: number) => {
    if (++visited > 100000 || depth > 80 || !value || typeof value !== 'object')
      return;
    const record = object(value);
    const item = object(object(object(record.result).data).media);
    if (Object.keys(item).length) media.push(item);
    for (const child of Object.values(value)) walk(child, depth + 1);
  };
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    if (!/\btype\s*=\s*["']application\/json["']/i.test(match[1])) continue;
    try {
      walk(JSON.parse(match[2]), 0);
    } catch {
      // A malformed unrelated script must not discard a valid post payload.
    }
  }
  const root = media.find(
    (item) =>
      item.code === code &&
      string(object(item.user).username).toLowerCase() === author &&
      string(object(item.caption).text).trim(),
  );
  if (!root) return null;
  const rootId = string(root.pk) || string(root.id).split('_')[0];
  const parts = [string(object(root.caption).text).trim()];
  const seen = new Set([code]);
  let foundConnection = false;
  let partial = visited > 100000;
  for (const fragment of media) {
    const fragmentId = string(fragment.pk) || string(fragment.id).split('_')[0];
    if (!rootId || fragmentId !== rootId) continue;
    if (fragment.code && fragment.code !== code) continue;
    const fragmentAuthor = string(object(fragment.user).username).toLowerCase();
    if (fragmentAuthor && fragmentAuthor !== author) continue;
    const info = object(fragment.text_post_app_info);
    const posts = object(object(info.self_thread).posts);
    if (!Array.isArray(posts.edges)) continue;
    foundConnection = true;
    if (object(posts.page_info).has_next_page !== false) partial = true;
    for (const edge of posts.edges) {
      const post = object(object(edge).node);
      const partCode = string(post.code);
      const text = string(object(post.caption).text).trim();
      if (
        !partCode ||
        !text ||
        string(object(post.user).username).toLowerCase() !== author
      ) {
        partial = true;
        continue;
      }
      if (seen.has(partCode)) continue;
      seen.add(partCode);
      parts.push(text);
    }
  }
  const text = parts.join('\n\n');
  return {
    text: text.slice(0, limit),
    partCount: parts.length,
    // Public payloads cannot prove that deleted/hidden parts never existed.
    sourceCompleteness:
      partial || !foundConnection || text.length > limit
        ? 'PARTIAL'
        : 'UNKNOWN',
  };
}

export function decodeSourceHtml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (all, entity: string) => {
      const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      };
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? all;
      const hex = entity[1].toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : all;
    },
  );
}

/** Never log URLs, HTML, provider payloads, cookies or arbitrary exception messages. */
export function sourceFailureCode(error: unknown): string {
  const e = error as { message?: string; code?: string; name?: string } | null;
  const message = e?.message ?? '';
  if (
    /^(?:SOURCE_[A-Z_]+|UNSAFE_SOURCE_[A-Z_]+|SOURCE_HTTP_\d{3})$/.test(message)
  )
    return message;
  if (
    /^(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH)$/.test(
      e?.code ?? '',
    )
  )
    return e!.code!;
  return e?.name === 'TimeoutError'
    ? 'SOURCE_TIMEOUT'
    : 'SOURCE_REQUEST_FAILED';
}
