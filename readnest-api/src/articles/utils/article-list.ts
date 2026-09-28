import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const articleListSelect = {
  id: true,
  source: true,
  url: true,
  title: true,
  author: true,
  summaryPreview: true,
  tags: true,
  processStatus: true,
  readStatus: true,
  savedAt: true,
  createdAt: true,
  updatedAt: true,
  generation: true,
  resultGeneration: true,
  generatedAt: true,
  stage: true,
  errorCode: true,
  lastSummaryError: true,
  retryable: true,
  retryAt: true,
  summaryRetryCount: true,
  retryWindowStartedAt: true,
  sourceCompleteness: true,
  extractionStatus: true,
} satisfies Prisma.SavedArticleSelect;

export function cursorScope(userId: string, filters: object) {
  return createHash('sha256')
    .update(JSON.stringify([userId, filters]))
    .digest('hex');
}
export function encodeCursor(
  item: { id: string; savedAt: Date },
  scope: string,
  secret: string,
) {
  const payload = Buffer.from(
    JSON.stringify({ id: item.id, savedAt: item.savedAt.toISOString(), scope }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function decodeCursor(
  token: string,
  scope: string,
  secret: string,
): { id: string; savedAt: Date } {
  try {
    const [payload, mac, extra] = token.split('.');
    if (!payload || !mac || extra) throw new Error();
    const expected = createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(mac, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    );
    if (!value || typeof value !== 'object') throw new Error();
    const cursor = value as Record<string, unknown>;
    if (
      cursor.scope !== scope ||
      typeof cursor.id !== 'string' ||
      cursor.id.length > 191 ||
      typeof cursor.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(cursor.savedAt))
    )
      throw new Error();
    return { id: cursor.id, savedAt: new Date(cursor.savedAt) };
  } catch {
    throw new BadRequestException(
      '목록 커서가 유효하지 않습니다. 목록을 새로 불러와 주세요.',
    );
  }
}

// Product dates and quotas use Asia/Seoul, independent of server deployment timezone.
export function productCalendar(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 3600_000);
  const today = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) -
      9 * 3600_000,
  );
  const week = new Date(today.getTime() - shifted.getUTCDay() * 86400_000);
  const month = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - 9 * 3600_000,
  );
  return { today, week, month };
}
