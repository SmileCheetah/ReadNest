import {
  decodeSourceHtml,
  extractThreadsSource,
  sourceFailureCode,
} from './threads-source';

const url = 'https://www.threads.com/@author/post/Root';
const root = {
  pk: '10',
  id: '10_20',
  code: 'Root',
  user: { username: 'author' },
  caption: { text: '짧은 본문입니다.' },
};
const post = (code: string, text: string, username = 'author') => ({
  code,
  caption: { text },
  user: { username },
});
const script = (media: unknown) =>
  `<script type="application/json">${JSON.stringify({ require: [{ __bbox: { result: { data: { media } } } }] })}</script>`;
const connection = (nodes: unknown[], hasNext = false, id = '10_20') => ({
  id,
  text_post_app_info: {
    self_thread: {
      posts: {
        edges: nodes.map((node) => ({ node })),
        page_info: { has_next_page: hasNext },
      },
    },
  },
});

describe('Threads source identity and continuation', () => {
  it('accepts short real posts and preserves arbitrarily long normal posts within safety budget', () => {
    for (const text of ['한 줄.', '긴 본문 '.repeat(2000)]) {
      const result = extractThreadsSource(
        script({ ...root, caption: { text } }) + script(connection([])),
        url,
        50000,
      );
      expect(result?.text).toBe(text.trim());
      expect(result?.sourceCompleteness).toBe('UNKNOWN');
    }
  });
  it('joins split payloads by post ID and retains all five independent points in order', () => {
    const nodes = [
      post('P2', '2. 둘째'),
      post('P3', '3. 셋째'),
      post('P4', '4. 넷째'),
      post('P5', '5. 다섯째'),
    ];
    const html =
      script({ ...root, caption: { text: '1. 첫째' } }) +
      script(connection(nodes)) +
      script(connection(nodes));
    const result = extractThreadsSource(html, url, 50000);
    expect(result?.text).toBe(
      '1. 첫째\n\n2. 둘째\n\n3. 셋째\n\n4. 넷째\n\n5. 다섯째',
    );
    expect(result?.partCount).toBe(5);
  });
  it('excludes related posts, quoted posts, other roots and same-author comments', () => {
    const html =
      script({
        ...root,
        text_post_app_info: {
          direct_replies: { edges: [{ node: post('Ad', '광고') }] },
        },
      }) +
      script(connection([post('Other', '다른 루트')], false, '99_20')) +
      `<script type="application/json">${JSON.stringify({ result: { data: { relatedPosts: { media: post('R', '추천') } } } })}</script>` +
      script(
        connection([
          post('Ok', '이어지는 글'),
          post('Bad', '다른 작성자', 'someone'),
        ]),
      );
    const result = extractThreadsSource(html, url, 50000);
    expect(result?.text).toBe('짧은 본문입니다.\n\n이어지는 글');
    expect(result?.sourceCompleteness).toBe('PARTIAL');
  });
  it('rejects login UI regardless of length and mismatched root identity', () => {
    expect(
      extractThreadsSource('Log in to Threads '.repeat(300), url, 50000),
    ).toBeNull();
    expect(
      extractThreadsSource(script({ ...root, code: 'Wrong' }), url, 50000),
    ).toBeNull();
    expect(
      extractThreadsSource(
        script({ ...root, user: { username: 'other' } }),
        url,
        50000,
      ),
    ).toBeNull();
  });
  it('marks pagination, missing continuation evidence and truncated source as partial', () => {
    expect(
      extractThreadsSource(script(root), url, 50000)?.sourceCompleteness,
    ).toBe('PARTIAL');
    expect(
      extractThreadsSource(
        script(root) + script(connection([], true)),
        url,
        50000,
      )?.sourceCompleteness,
    ).toBe('PARTIAL');
    expect(
      extractThreadsSource(script(root) + script(connection([])), url, 3),
    ).toMatchObject({ text: '짧은 ', sourceCompleteness: 'PARTIAL' });
  });
  it('tolerates malformed unrelated scripts without executing them', () => {
    expect(
      extractThreadsSource(
        '<script type="application/json">broken</script>' + script(root),
        url,
        50000,
      )?.text,
    ).toBe(root.caption.text);
  });
  it('decodes decimal/hex Korean and @ entities without double decoding', () => {
    expect(decodeSourceHtml('&#064;author &#xD55C;&#44544; &amp;lt;')).toBe(
      '@author 한글 &lt;',
    );
    expect(decodeSourceHtml('&#x110000; &#xD800;')).toBe('&#x110000; &#xD800;');
  });
  it('retains safe reason codes but never raw error messages or URLs', () => {
    expect(sourceFailureCode(new Error('SOURCE_BUDGET_EXHAUSTED'))).toBe(
      'SOURCE_BUDGET_EXHAUSTED',
    );
    expect(sourceFailureCode(new Error('https://host/?secret=private'))).toBe(
      'SOURCE_REQUEST_FAILED',
    );
  });
});
