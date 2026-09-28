import { ConfigService } from '@nestjs/config';
import { ContentExtractorService } from './content-extractor.service';
import { safeSourceRequest } from './safe-source-http';
jest.mock('./safe-source-http', () => ({ safeSourceRequest: jest.fn() }));

describe('ContentExtractorService', () => {
  beforeEach(() => jest.clearAllMocks());
  const service = new ContentExtractorService(new ConfigService());
  const cleanThreadsText = (text: string) =>
    (
      service as unknown as {
        cleanThreadsText(value: string): string;
      }
    ).cleanThreadsText(text);

  it('keeps numbered author replies and stops before related threads', () => {
    const result = cleanThreadsText(`
스레드
조회 1만회
wakeupmoon.ai
15시간
메인 글입니다.
wakeupmoon.ai
15시간
·
작성자
1. 첫 번째 주장
첫 번째 설명입니다.
wakeupmoon.ai
15시간
·
작성자
17. 결론
마지막 설명입니다.
관련 스레드
다른 사용자의 글
`);

    expect(result).toContain('메인 글입니다.');
    expect(result).toContain('1. 첫 번째 주장');
    expect(result).toContain('17. 결론');
    expect(result).not.toContain('다른 사용자의 글');
    expect(result).not.toContain('작성자');
  });

  it('stops before the login wall', () => {
    const result = cleanThreadsText(`
메인 글입니다.
로그인하여 더 많은 답글을 확인해보세요.
로그인 화면 설명
`);

    expect(result).toBe('메인 글입니다.');
  });

  it('accepts short post metadata but rejects empty, login, or mismatched short source', async () => {
    const extractor = new ContentExtractorService(new ConfigService());
    jest
      .spyOn(
        extractor as unknown as {
          extractThreadsWithBrowser: () => Promise<unknown>;
        },
        'extractThreadsWithBrowser',
      )
      .mockResolvedValue({ text: '', extractionStatus: 'FAILED' });
    const post =
      '짧아도 중요한 주장을 담은 글입니다. 길이가 아니라 실제 본문인지가 중요합니다.';
    for (const metadata of [
      '<meta property="og:url" content="https://www.threads.com/@author/post/AbC">',
      '<link href="https://www.threads.com/@author/post/AbC" rel="canonical">',
    ]) {
      jest.mocked(safeSourceRequest).mockResolvedValue({
        status: 200,
        headers: {},
        body: Buffer.from(
          `${metadata}<meta property="og:description" content="${post}">`,
        ),
      });
      const result = await extractor.extract(
        'https://www.threads.com/@author/post/AbC',
      );
      expect(result.text).toBe(post);
      expect(result.extractionStatus).toBe('FALLBACK_SUCCESS');
      expect(result.sourceCompleteness).toBe('PARTIAL');
    }
    for (const description of [
      '',
      'Log in to Threads to continue',
      '로그인하여 더 많은 답글을 확인해보세요.',
    ]) {
      jest.mocked(safeSourceRequest).mockResolvedValue({
        status: 200,
        headers: {},
        body: Buffer.from(
          `<meta property="og:url" content="https://www.threads.com/@author/post/AbC"><meta property="og:description" content="${description}">`,
        ),
      });
      expect(
        (await extractor.extract('https://www.threads.com/@author/post/AbC'))
          .extractionStatus,
      ).toBe('FAILED');
    }
    jest.mocked(safeSourceRequest).mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from(
        `<meta property="og:url" content="https://www.threads.com/@author/post/Other"><meta property="og:description" content="${post}">`,
      ),
    });
    expect(
      (await extractor.extract('https://www.threads.com/@author/post/AbC'))
        .extractionStatus,
    ).toBe('FAILED');
  });

  it('reads identified source before optional browser resources and keeps continuation text', async () => {
    const extractor = new ContentExtractorService(new ConfigService());
    const browser = jest.spyOn(
      extractor as unknown as {
        extractThreadsWithBrowser: () => Promise<unknown>;
      },
      'extractThreadsWithBrowser',
    );
    const root = {
      pk: '1',
      code: 'AbC',
      user: { username: 'author' },
      caption: { text: '짧은 정상 글' },
    };
    const fragment = {
      id: '1_2',
      text_post_app_info: {
        self_thread: {
          posts: {
            edges: [
              {
                node: {
                  code: 'Next',
                  user: { username: 'author' },
                  caption: { text: '독립적인 다음 주장' },
                },
              },
            ],
            page_info: { has_next_page: false },
          },
        },
      },
    };
    const html = [root, fragment]
      .map(
        (media) =>
          `<script type="application/json">${JSON.stringify({ result: { data: { media } } })}</script>`,
      )
      .join('');
    jest
      .mocked(safeSourceRequest)
      .mockResolvedValue({ status: 200, headers: {}, body: Buffer.from(html) });
    const result = await extractor.extract(
      'https://www.threads.com/@author/post/AbC',
    );
    expect(result.text).toBe('짧은 정상 글\n\n독립적인 다음 주장');
    expect(result.extractionStatus).toBe('SUCCESS');
    expect(browser).not.toHaveBeenCalled();
  });

  it('retains verified metadata even when browser exhausts its separate resource budget', async () => {
    const extractor = new ContentExtractorService(new ConfigService());
    jest
      .spyOn(
        extractor as unknown as {
          extractThreadsWithBrowser: () => Promise<unknown>;
        },
        'extractThreadsWithBrowser',
      )
      .mockResolvedValue({ text: '', extractionStatus: 'FAILED' });
    jest.mocked(safeSourceRequest).mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from(
        '<meta property="og:url" content="https://www.threads.com/&#064;author/post/AbC"><meta property="og:description" content="&#xD55C;&#44544; 짧은 글">',
      ),
    });
    const result = await extractor.extract(
      'https://www.threads.com/@author/post/AbC',
    );
    expect(result).toMatchObject({
      text: '한글 짧은 글',
      extractionStatus: 'FALLBACK_SUCCESS',
      sourceCompleteness: 'PARTIAL',
    });
    expect(safeSourceRequest).toHaveBeenCalledTimes(1);
  });
});
