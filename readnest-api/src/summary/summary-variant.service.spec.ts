import { SummaryDensity, SummaryTaskState } from '@prisma/client';
import { SummaryVariantService } from './summary-variant.service';

const markdown = '# 제목\n\n핵심 내용입니다.';

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'article' }]),
    savedArticle: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'article',
        rawText: '같은 수집 원문',
        resultGeneration: 3,
      }),
    },
    summaryVariant: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    summaryVariantTask: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const jobs = { dispatch: jest.fn() };
  const service = new SummaryVariantService(prisma as never, jobs as never);
  return { tx, prisma, jobs, service };
}

describe('SummaryVariantService', () => {
  it('returns a current cached result without creating another AI task', async () => {
    const s = setup();
    s.tx.summaryVariant.findUnique.mockResolvedValue({
      id: 'variant',
      density: SummaryDensity.CONCISE,
      generation: 1,
      sourceGeneration: 3,
      state: SummaryTaskState.SUCCEEDED,
      markdown,
      errorCode: null,
      retryable: true,
      retryAt: null,
      generatedAt: new Date(),
    });

    const result = await s.service.request(
      'owner',
      'article',
      'concise',
      'request-one',
    );

    expect(result.summaryMarkdown).toBe(markdown);
    expect(s.tx.summaryVariantTask.create).not.toHaveBeenCalled();
    expect(s.jobs.dispatch).not.toHaveBeenCalled();
  });

  it('creates one durable task from the saved raw source generation', async () => {
    const s = setup();
    s.tx.summaryVariant.findUnique.mockResolvedValue(null);
    s.tx.summaryVariant.create.mockResolvedValue({
      id: 'variant',
      density: SummaryDensity.DETAILED,
      generation: 1,
      sourceGeneration: 3,
      state: SummaryTaskState.PENDING,
      markdown: null,
      errorCode: null,
      retryable: true,
      retryAt: null,
      generatedAt: null,
    });

    const result = await s.service.request(
      'owner',
      'article',
      'detailed',
      'request-two',
    );

    expect(s.tx.savedArticle.findFirst).toHaveBeenCalledWith({
      where: { id: 'article', userId: 'owner' },
      select: {
        id: true,
        rawText: true,
        resultGeneration: true,
      },
    });
    expect(s.tx.summaryVariantTask.create).toHaveBeenCalledWith({
      data: {
        variantId: 'variant',
        generation: 1,
        sourceGeneration: 3,
        requestKey: 'request-two',
      },
    });
    expect(result.state).toBe('PENDING');
    expect(s.jobs.dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not start a variant without the completed source snapshot', async () => {
    const s = setup();
    s.tx.savedArticle.findFirst.mockResolvedValue({
      id: 'article',
      rawText: null,
      resultGeneration: null,
    });

    await expect(
      s.service.request('owner', 'article', 'concise'),
    ).rejects.toMatchObject({ status: 400 });
    expect(s.tx.summaryVariantTask.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported density instead of silently changing the default', async () => {
    const s = setup();
    await expect(
      s.service.request('owner', 'article', 'standard'),
    ).rejects.toMatchObject({ status: 400 });
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns only variants built from the current source generation', async () => {
    const s = setup();
    s.prisma.savedArticle.findFirst.mockResolvedValue({
      resultGeneration: 3,
      summaryVariants: [
        {
          density: SummaryDensity.CONCISE,
          sourceGeneration: 2,
          state: SummaryTaskState.SUCCEEDED,
          markdown,
          errorCode: null,
          retryable: true,
          retryAt: null,
          generatedAt: new Date(),
        },
        {
          density: SummaryDensity.DETAILED,
          sourceGeneration: 3,
          state: SummaryTaskState.SUCCEEDED,
          markdown,
          errorCode: null,
          retryable: true,
          retryAt: null,
          generatedAt: new Date(),
        },
      ],
    });

    const result = await s.service.list('owner', 'article');
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].density).toBe('DETAILED');
  });
});
