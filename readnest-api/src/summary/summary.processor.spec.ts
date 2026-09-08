import { SummaryProcessor } from './summary.processor';

describe('SummaryProcessor generation guard', () => {
  it('skips stale jobs before extraction or AI calls', async () => {
    const prisma = {
      savedArticle: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'a1', summaryGeneration: 3 }),
      },
    };
    const extractor = { extract: jest.fn() };
    const ai = { summarize: jest.fn() };
    const threads = { detectAndLink: jest.fn() };
    const processor = new SummaryProcessor(
      prisma as any,
      extractor as any,
      ai as any,
      threads as any,
    );

    await processor.process({
      data: { articleId: 'a1', generation: 2 },
    } as any);

    expect(extractor.extract).not.toHaveBeenCalled();
    expect(ai.summarize).not.toHaveBeenCalled();
  });
});
