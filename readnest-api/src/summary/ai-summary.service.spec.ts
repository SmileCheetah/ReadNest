/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  AiSummaryService,
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

  it('sends only the requested plain prompt and stores Luna output as Markdown', async () => {
    const service = createService('### 핵심 주장\n\n원문에 충실한 요약이다.');
    const result = await service.summarize(input);
    const create = service.client.responses.create;

    expect(create).toHaveBeenCalledWith({
      model: 'gpt-5.6-luna',
      input: '다음 글을 요약해줘.\n\n원문 내용이다.',
    });
    expect(result.summary).toBe('### 핵심 주장\n\n원문에 충실한 요약이다.');
    expect(result.meta.summaryMarkdown).toBe(result.summary);
    expect(result.keyPoints).toEqual([]);
    expect(result.tags).toEqual([]);
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
