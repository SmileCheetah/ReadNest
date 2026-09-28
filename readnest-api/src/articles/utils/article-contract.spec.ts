import { validate } from 'class-validator';
import { CreateArticleDto } from '../dto/create-article.dto';
import { normalizeUrl, parseThreadsUrl } from './normalize-url';
import {
  positiveInteger,
  summaryPreview,
  withArticleStatus,
} from './summary-preview';
import {
  cursorScope,
  decodeCursor,
  encodeCursor,
  productCalendar,
} from './article-list';

describe('article input and list contracts', () => {
  it('deduplicates tracking, locale, host and username variants using case-sensitive post ID', () => {
    const first = normalizeUrl(
      'https://www.threads.com/@alice/post/AbC?xmt=one&hl=ko',
    );
    expect(normalizeUrl('https://threads.net/@renamed/post/AbC?xmt=two')).toBe(
      first,
    );
    expect(normalizeUrl('https://threads.com/@alice/post/abc')).not.toBe(first);
    expect(
      parseThreadsUrl(
        `https://threads.com/@alice/post/AbC?xmt=${'a'.repeat(1000)}`,
      ).canonical,
    ).toBe('https://www.threads.com/@alice/post/AbC');
  });
  it.each([
    'http://threads.com/@a/post/b',
    'https://127.0.0.1/@a/post/b',
    'https://threads.com.evil.test/@a/post/b',
    'https://user:pass@threads.com/@a/post/b',
    'https://threads.com:444/@a/post/b',
    'https://threads.com/@a/post/' + 'a'.repeat(200),
  ])('rejects unsupported URL %s', (url) => {
    expect(() => normalizeUrl(url)).toThrow();
  });
  it('matches the DB title boundary including unicode', async () => {
    for (const char of ['가', '😀']) {
      const dto = Object.assign(new CreateArticleDto(), {
        url: 'https://threads.com/@a/post/b',
        title: char.repeat(191),
      });
      expect(await validate(dto)).toHaveLength(0);
      dto.title += char;
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
  it('derives preview from content, not the heading or numbered title', () => {
    expect(
      summaryPreview(
        '# 제목\n\n### 핵심 내용\n\n**1. 중요한 제목**\n\n**내용**이 있다.\n다음 문장.',
      ),
    ).toBe('내용이 있다. 다음 문장.');
    expect(summaryPreview('# 제목')).toBeNull();
    expect(summaryPreview('# 제목\n본문 **강조**입니다.')).toBe(
      '본문 강조입니다.',
    );
    expect(summaryPreview('**1. 제목**\\\n본문입니다.')).toBe('본문입니다.');
    expect(summaryPreview('1. **제목**\n본문입니다.')).toBe('본문입니다.');
    expect(summaryPreview('- 목록\n  이어지는 설명\n\n본문입니다.')).toBe(
      '본문입니다.',
    );
    expect(summaryPreview('> 인용문\n본문입니다.')).toBe('본문입니다.');
  });
  it('exposes manual retry availability independently of automatic retry classification', () => {
    expect(
      withArticleStatus({ processStatus: 'SUMMARY_FAILED', retryable: false })
        .retryable,
    ).toBe(true);
    expect(withArticleStatus({ processStatus: 'SUMMARIZING' }).retryable).toBe(
      false,
    );
    const waiting = withArticleStatus({
      processStatus: 'SUMMARY_FAILED',
      retryAt: new Date(Date.now() + 59000),
    });
    expect(waiting.retryable).toBe(false);
    expect(waiting.retryAfterSeconds).toBeGreaterThanOrEqual(59);
    for (const value of [undefined, 'bad', Infinity, -1, 0, 2.5])
      expect(positiveInteger(value, 3)).toBe(3);
    expect(positiveInteger('4', 3)).toBe(4);
  });
  it('binds a cursor to user and filters and rejects tampering', () => {
    const scope = cursorScope('u', { search: 'text' });
    const item = { id: 'a', savedAt: new Date('2026-09-28T12:00:00Z') };
    const token = encodeCursor(item, scope, 'test-secret');
    expect(decodeCursor(token, scope, 'test-secret')).toEqual(item);
    expect(() =>
      decodeCursor(
        token,
        cursorScope('other', { search: 'text' }),
        'test-secret',
      ),
    ).toThrow();
    expect(() => decodeCursor(token + 'a', scope, 'test-secret')).toThrow();
    expect(() =>
      decodeCursor(
        token,
        cursorScope('u', { search: 'changed' }),
        'test-secret',
      ),
    ).toThrow();
  });
  it('uses Korean date boundaries independently of host timezone', () => {
    expect(
      productCalendar(new Date('2026-09-28T15:01:00Z')).today.toISOString(),
    ).toBe('2026-09-28T15:00:00.000Z');
  });
});
