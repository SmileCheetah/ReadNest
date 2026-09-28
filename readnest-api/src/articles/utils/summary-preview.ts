export function summaryPreview(markdown: unknown): string | null {
  if (typeof markdown !== 'string') return null;
  const paragraph: string[] = [];
  let inList = false;
  // Same block boundaries as the native renderer. A blank line is not required
  // after a heading, and an indented list continuation is not a preview paragraph.
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading =
      /^(#{1,3})\s+.+$/.test(line) ||
      /^\d+\.\s+\*\*[^*]+\*\*$/.test(line) ||
      /^\*\*\d+[.)]\s+[^*\n]{1,120}\*\*\\?$/.test(line);
    const list = /^(?:\d+[.)]\s+|[-*•]\s+)/.test(line);
    if (!line || heading || list || line.startsWith('>')) {
      if (paragraph.length) break;
      inList = list;
      continue;
    }
    if (inList && /^\s{2,}\S/.test(raw)) continue;
    inList = false;
    paragraph.push(raw.replace(/(?: {2,}|\\)$/, '').trim());
  }
  return (
    paragraph
      .join(' ')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\\([\\*_[\]`])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim() || null
  );
}

export function positiveInteger(
  value: unknown,
  fallback: number,
  minimum = 1,
): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : fallback;
}

export function withArticleStatus<
  T extends {
    retryAt?: Date | null;
    processStatus?: string;
    summaryRetryCount?: number;
    retryWindowStartedAt?: Date | null;
    summaryPreview?: string | null;
    summaryMeta?: unknown;
  },
>(article: T) {
  const meta = article.summaryMeta as { summaryMarkdown?: unknown } | null;
  const limit = positiveInteger(process.env.SUMMARY_RETRY_LIMIT, 3);
  const windowSeconds = positiveInteger(
    process.env.SUMMARY_RETRY_WINDOW_SECONDS,
    3600,
    60,
  );
  const quotaReset =
    (article.summaryRetryCount ?? 0) >= limit && article.retryWindowStartedAt
      ? article.retryWindowStartedAt.getTime() + windowSeconds * 1000
      : 0;
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil(
      (Math.max(quotaReset, article.retryAt?.getTime() ?? 0) - Date.now()) /
        1000,
    ),
  );
  return {
    ...article,
    summaryPreview:
      article.summaryPreview ?? summaryPreview(meta?.summaryMarkdown),
    // Public retryable means manual retry availability, not the worker's backoff policy.
    retryable:
      article.processStatus !== 'SUMMARIZING' && retryAfterSeconds === 0,
    retryAfterSeconds,
  };
}
