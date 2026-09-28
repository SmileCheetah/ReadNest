import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const THREADS_HOSTS = new Set([
  'threads.com',
  'www.threads.com',
  'threads.net',
  'www.threads.net',
]);

// A post's shortcode is its identity; username/locale/tracking can change.
export function parseThreadsUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BadRequestException(
      '올바른 Threads 게시물 주소를 입력해 주세요.',
    );
  }
  const match = url.pathname.match(/^\/@([\w.]+)\/post\/([A-Za-z0-9_-]+)\/?$/);
  if (
    url.protocol !== 'https:' ||
    !THREADS_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !match ||
    input.length > 8192
  ) {
    throw new BadRequestException(
      'HTTPS Threads 게시물 링크만 저장할 수 있습니다.',
    );
  }
  const canonical = `https://www.threads.com/@${match[1]}/post/${match[2]}`;
  // MySQL's default collation is case-insensitive; shortcodes are not.
  const identity = `threads:${createHash('sha256').update(match[2]).digest('hex')}`;
  if (Array.from(canonical).length > 191 || identity.length > 191) {
    throw new BadRequestException(
      '게시물 주소가 너무 깁니다. 공유 링크를 다시 확인해 주세요.',
    );
  }
  return { canonical, identity, postId: match[2], author: match[1] };
}

export function normalizeUrl(input: string): string {
  return parseThreadsUrl(input).identity;
}
