import { SummaryVariantProcessor } from './summary-variant.processor';

const markdown = '# 자세한 제목\n\n원문의 근거를 보존한 요약입니다.';

function setup() {
  const lease = {
    taskId: 'task',
    variantId: 'variant',
    generation: 1,
    sourceGeneration: 4,
    token: 'token',
  };
  const jobs = {
    claim: jest.fn().mockResolvedValue({
      article: {
        id: 'article',
        url: 'https://www.threads.com/@author/post/one',
        title: '원문 제목',
        rawText: '저장된 전체 원문',
      },
      variant: { density: 'DETAILED' },
      task: { attempts: 1, result: null },
      lease,
    }),
    heartbeat: jest.fn().mockResolvedValue(true),
    checkpoint: jest.fn(),
    complete: jest.fn().mockResolvedValue(true),
    fail: jest.fn(),
  };
  const ai = {
    summarize: jest.fn().mockResolvedValue({
      meta: { summaryMarkdown: markdown },
    }),
  };
  const processor = new SummaryVariantProcessor(jobs as never, ai as never);
  return {
    jobs,
    ai,
    processor,
    lease,
    job: { data: { ...lease, token: undefined } } as never,
  };
}

describe('SummaryVariantProcessor', () => {
  it('always creates a density result from the saved raw source', async () => {
    const s = setup();
    await s.processor.process(s.job);

    expect(s.ai.summarize).toHaveBeenCalledWith({
      url: 'https://www.threads.com/@author/post/one',
      title: '원문 제목',
      text: '저장된 전체 원문',
      density: 'DETAILED',
    });
    expect(s.jobs.complete).toHaveBeenCalledWith(s.lease, markdown);
    expect(s.jobs.checkpoint).toHaveBeenCalledWith(s.lease, markdown);
  });

  it('reuses a validated model checkpoint after a worker retry', async () => {
    const s = setup();
    s.jobs.claim.mockResolvedValue({
      article: {
        id: 'article',
        url: 'https://www.threads.com/@author/post/one',
        title: '원문 제목',
        rawText: '저장된 전체 원문',
      },
      variant: { density: 'DETAILED' },
      task: { attempts: 2, result: markdown },
      lease: s.lease,
    });

    await s.processor.process(s.job);
    expect(s.ai.summarize).not.toHaveBeenCalled();
    expect(s.jobs.checkpoint).not.toHaveBeenCalled();
    expect(s.jobs.complete).toHaveBeenCalledWith(s.lease, markdown);
  });

  it('keeps the existing document when alternate generation fails', async () => {
    const s = setup();
    s.ai.summarize.mockRejectedValue(new Error('provider unavailable'));
    await s.processor.process(s.job);

    expect(s.jobs.complete).not.toHaveBeenCalled();
    expect(s.jobs.fail).toHaveBeenCalledWith(
      s.lease,
      expect.objectContaining({ code: 'PERSISTENCE_FAILED' }),
      1,
    );
  });
});
