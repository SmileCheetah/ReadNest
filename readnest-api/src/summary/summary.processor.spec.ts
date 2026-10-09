import { SummaryProcessor } from './summary.processor';
import { SummaryGenerationError } from './summary-errors';

const document = '# 제목\n\n중요한 근거가 담긴 본문입니다.';
function setup() {
  const article = {
    id: 'a',
    userId: 'u',
    url: 'https://www.threads.com/@author/post/AbC',
    rawText: '오래된 원문',
  };
  const lease = { articleId: 'a', taskId: 't', generation: 1, token: 'token' };
  const jobs = {
    claim: jest.fn().mockResolvedValue({
      article,
      task: { attempts: 1, result: null },
      lease,
    }),
    heartbeat: jest.fn().mockResolvedValue(true),
    stage: jest.fn(),
    checkpoint: jest.fn(),
    complete: jest.fn().mockResolvedValue(true),
    fail: jest.fn(),
  };
  const source = {
    title: '제목',
    text: '새로 추출한 원문',
    extractionStatus: 'SUCCESS',
    extractionConfidence: 0.9,
  };
  const extractor = { extract: jest.fn().mockResolvedValue(source) };
  const result = {
    title: '제목',
    summary: document,
    keyPoints: [],
    tags: [],
    contextInsufficient: false,
    meta: { summaryMarkdown: document },
  };
  const ai = { summarize: jest.fn().mockResolvedValue(result) };
  const detection = { detectAndLink: jest.fn() };
  const classification = { schedule: jest.fn().mockResolvedValue(true) };
  const processor = new SummaryProcessor(
    jobs as never,
    extractor as never,
    ai as never,
    detection as never,
    classification as never,
  );
  const job = { data: { articleId: 'a', generation: 1, taskId: 't' } } as never;
  return {
    jobs,
    extractor,
    ai,
    detection,
    classification,
    processor,
    job,
    source,
    article,
    result,
    lease,
  };
}

describe('summary processing integrity', () => {
  it('replaces source rather than appending it and never claims unverified completeness', async () => {
    const s = setup();
    await s.processor.process(s.job);
    await s.processor.process(s.job);
    for (const [input] of s.ai.summarize.mock.calls)
      expect((input as { text: string }).text).toBe('새로 추출한 원문');
    expect(s.jobs.complete).toHaveBeenCalledWith(
      s.lease,
      expect.objectContaining({
        rawText: '새로 추출한 원문',
        sourceCompleteness: 'UNKNOWN',
        processStatus: 'SUMMARY_DONE',
        summaryPreview: '중요한 근거가 담긴 본문입니다.',
      }),
    );
    expect(s.classification.schedule).toHaveBeenCalledWith('a');
  });
  it('does not invoke AI without usable source', async () => {
    const s = setup();
    s.extractor.extract.mockResolvedValue({
      ...s.source,
      text: '',
      extractionStatus: 'FAILED',
    });
    await s.processor.process(s.job);
    expect(s.ai.summarize).not.toHaveBeenCalled();
    expect(s.jobs.complete).not.toHaveBeenCalled();
    expect(s.jobs.fail).toHaveBeenCalledWith(
      s.lease,
      expect.objectContaining({ code: 'EXTRACTION_FAILED' }),
      1,
    );
  });
  it('keeps successful summary when optional thread detection fails', async () => {
    const s = setup();
    s.detection.detectAndLink.mockRejectedValue(
      new Error('enrichment unavailable'),
    );
    await s.processor.process(s.job);
    expect(s.jobs.complete).toHaveBeenCalledTimes(1);
    expect(s.jobs.fail).not.toHaveBeenCalled();
  });
  it('keeps successful summary when classification dispatch fails', async () => {
    const s = setup();
    s.classification.schedule.mockRejectedValue(new Error('queue unavailable'));
    await s.processor.process(s.job);
    expect(s.jobs.complete).toHaveBeenCalledTimes(1);
    expect(s.jobs.fail).not.toHaveBeenCalled();
  });
  it('rejects unsafe output and never persists it', async () => {
    const s = setup();
    s.ai.summarize.mockResolvedValue({
      ...s.result,
      meta: { summaryMarkdown: '<script>bad</script>' },
    });
    await s.processor.process(s.job);
    expect(s.jobs.complete).not.toHaveBeenCalled();
    expect(s.jobs.fail).toHaveBeenCalledWith(
      s.lease,
      expect.objectContaining({ code: 'INVALID_MARKDOWN', retryable: false }),
      1,
    );
  });
  it('reuses a durable model result on a persistence retry', async () => {
    const s = setup();
    s.jobs.claim.mockResolvedValue({
      article: s.article,
      lease: s.lease,
      task: { attempts: 2, result: { source: s.source, summary: s.result } },
    });
    await s.processor.process(s.job);
    expect(s.extractor.extract).not.toHaveBeenCalled();
    expect(s.ai.summarize).not.toHaveBeenCalled();
    expect(s.jobs.complete).toHaveBeenCalledTimes(1);
  });
  it('does not write after loss of lease or failed claim', async () => {
    const s = setup();
    s.jobs.stage.mockRejectedValue(
      new SummaryGenerationError('stale', 'STALE_JOB', false),
    );
    await s.processor.process(s.job);
    expect(s.jobs.complete).not.toHaveBeenCalled();
    expect(s.jobs.fail).not.toHaveBeenCalled();
    s.jobs.claim.mockResolvedValue(null);
    await s.processor.process(s.job);
    expect(s.jobs.stage).toHaveBeenCalledTimes(1);
  });
});
