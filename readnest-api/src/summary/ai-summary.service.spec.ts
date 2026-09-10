/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  AiSummaryService,
  buildSummaryPrompt,
  MAX_SUMMARY_MARKDOWN_LENGTH,
  SummaryGenerationError,
  validateSummaryMarkdown,
} from './ai-summary.service';

describe('validateSummaryMarkdown', () => {
  it('accepts natural Markdown and rejects unsupported content', () => {
    expect(
      validateSummaryMarkdown(
        '### 핵심 주장\n\n**중요한 내용**이다.\n\n1. 첫 번째\n2. 두 번째\n\n> 결론',
      ),
    ).toBe(true);
    expect(validateSummaryMarkdown('<script>alert(1)</script>')).toBe(false);
    expect(validateSummaryMarkdown('```ts\nconsole.log(1)\n```')).toBe(false);
    expect(validateSummaryMarkdown('   ')).toBe(false);
    expect(
      validateSummaryMarkdown('a'.repeat(MAX_SUMMARY_MARKDOWN_LENGTH + 1)),
    ).toBe(false);
  });
});

describe('AiSummaryService', () => {
  const input = {
    url: 'https://example.com/article',
    title: '원문 제목',
    text: '원문 내용이다.',
  };

  function createService(responseText: string) {
    const service = Object.create(AiSummaryService.prototype);
    service.logger = { warn: jest.fn() };
    service.model = 'gpt-5.6-luna';
    service.client = {
      responses: {
        create: jest.fn().mockResolvedValue({ output_text: responseText }),
      },
    };
    return service;
  }

  it('sends the summary-editor prompt and stores Luna output as Markdown', async () => {
    const service = createService('# 요약 제목\n\n원문에 충실한 요약이다.');
    const result = await service.summarize(input);
    const create = service.client.responses.create;

    expect(create).toHaveBeenCalledWith({
      model: 'gpt-5.6-luna',
      input: buildSummaryPrompt('원문 내용이다.'),
    });
    expect(result.summary).toBe('# 요약 제목\n\n원문에 충실한 요약이다.');
    expect(result.meta.summaryMarkdown).toBe(result.summary);
    expect(result.title).toBe('요약 제목');
    expect(result.meta.title).toBe('요약 제목');
    expect(result.keyPoints).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it('uses a bounded fallback title when the Markdown has no h1', async () => {
    const longTitle = '가'.repeat(250);
    const result = await createService('요약 본문입니다.').summarize({
      ...input,
      title: longTitle,
    });
    const title = result.title as string;

    expect(Array.from(title)).toHaveLength(191);
    expect(title).toMatch(/…$/);
  });

  it('includes the requested principles, format, and source in the prompt', () => {
    const prompt = buildSummaryPrompt('테스트 원문');

    expect(prompt).toContain(
      '원문에 없는 정보, 추측, 평가, 사실을 추가하지 않는다.',
    );
    expect(prompt).toContain('최대 두 문장의 한 문단');
    expect(prompt).toContain('자연스러운 1~2문장');
    expect(prompt).toContain(
      '한 줄 요약 뒤에는 결론을 반복하는 문장을 추가하지 않는다.',
    );
    expect(prompt).toContain('### 핵심 내용');
    expect(prompt).toContain('### 한 줄 요약');
    expect(prompt).toMatch(/다음 글을 요약해줘\.\n\n테스트 원문$/);
  });

  it('rejects an empty or unsafe model response', async () => {
    await expect(createService('   ').summarize(input)).rejects.toBeInstanceOf(
      SummaryGenerationError,
    );
    await expect(
      createService('<script>alert(1)</script>').summarize(input),
    ).rejects.toBeInstanceOf(SummaryGenerationError);
  });

  it('does not create a placeholder when configuration is missing', async () => {
    const service = Object.create(AiSummaryService.prototype);
    service.client = null;

    await expect(service.summarize(input)).rejects.toBeInstanceOf(
      SummaryGenerationError,
    );
  });

  it.each(['timeout', '429', '500'])(
    'returns a retryable error when OpenAI returns %s',
    async (kind) => {
      const service = Object.create(AiSummaryService.prototype);
      service.logger = { warn: jest.fn() };
      service.client = {
        responses: {
          create: jest.fn().mockRejectedValue(new Error(`OpenAI ${kind}`)),
        },
      };
      service.model = 'gpt-5.6-luna';

      await expect(service.summarize(input)).rejects.toEqual(
        expect.objectContaining({
          name: 'SummaryGenerationError',
          message: expect.stringContaining('다시 시도'),
        }),
      );
    },
  );
});
