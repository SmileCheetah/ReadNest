/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { SummaryService } from './summary.service';

describe('summary polling contract', () => {
  it('requests only lightweight state and scopes the lookup to the owner', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'article',
      processStatus: 'SUMMARY_DONE',
      generation: 2,
      resultGeneration: 2,
      summaryPreview: '첫 본문',
    });
    const service = new SummaryService(
      { savedArticle: { findFirst } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const status = await service.getArticleSummaryStatus('owner', 'article');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'article', userId: 'owner' },
        select: expect.not.objectContaining({ summary: true }),
      }),
    );
    const select = (
      findFirst.mock.calls[0][0] as { select: Record<string, boolean> }
    ).select;
    expect(select.rawText).toBeUndefined();
    expect(select.summaryMeta).toBeUndefined();
    expect(status).not.toHaveProperty('summary');
    expect(status).not.toHaveProperty('rawText');
    expect(status).not.toHaveProperty('summaryMeta');
    expect(status.summaryPreview).toBe('첫 본문');
  });
});
