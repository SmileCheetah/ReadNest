import { ConfigService } from '@nestjs/config';
import { ArticlesService } from './articles.service';

describe('legacy cursor preview', () => {
  it('derives missing previews in one owner-scoped batch without returning body fields', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'old',
          savedAt: new Date(),
          summaryPreview: null,
          processStatus: 'SUMMARY_DONE',
        },
        {
          id: 'new',
          savedAt: new Date(),
          summaryPreview: '이미 있는 미리보기',
          processStatus: 'SUMMARY_DONE',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'old',
          summaryMeta: { summaryMarkdown: '# 제목\n본문 **내용**' },
          summary: 'old copy',
        },
      ]);
    const service = new ArticlesService(
      { savedArticle: { findMany } } as never,
      {} as never,
      new ConfigService({ JWT_SECRET: 'test-secret' }),
    );
    const result = await service.findAll('owner', {
      pagination: 'cursor',
      limit: 30,
    });
    if (Array.isArray(result)) throw new Error('Expected cursor response');
    expect(result.items.map((item) => item.summaryPreview)).toEqual([
      '본문 내용',
      '이미 있는 미리보기',
    ]);
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'owner', id: { in: ['old'] } },
      select: { id: true, summaryMeta: true, summary: true },
    });
    for (const item of result.items) {
      expect(item).not.toHaveProperty('summary');
      expect(item).not.toHaveProperty('summaryMeta');
      expect(item).not.toHaveProperty('rawText');
    }
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
