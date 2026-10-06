import { ConfigService } from '@nestjs/config';
import { ArticlesService } from './articles.service';
import { NotFoundException } from '@nestjs/common';

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

describe('article deletion with knowledge memberships', () => {
  function setup() {
    const tx = {
      $queryRaw: jest
        .fn<
          Promise<Array<{ id: string }>>,
          [TemplateStringsArray, ...unknown[]]
        >()
        .mockResolvedValue([{ id: 'owner' }]),
      knowledgeTopic: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      savedArticle: {
        delete: jest.fn().mockResolvedValue({ id: 'article-1' }),
      },
    };
    const service = new ArticlesService(
      {
        $transaction: jest.fn((callback: (db: typeof tx) => Promise<unknown>) =>
          callback(tx),
        ),
      } as never,
      {} as never,
      new ConfigService(),
    );
    return { tx, service };
  }

  it('bumps affected owner topics before cascading article links in one transaction', async () => {
    const { tx, service } = setup();
    await expect(service.remove('owner', 'article-1')).resolves.toEqual({
      deleted: true,
      id: 'article-1',
    });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['owner']);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(['article-1', 'owner']);
    expect(tx.knowledgeTopic.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner',
        articles: { some: { articleId: 'article-1' } },
      },
      data: { revision: { increment: 1 } },
    });
    expect(tx.savedArticle.delete).toHaveBeenCalledWith({
      where: { id: 'article-1', userId: 'owner' },
    });
    expect(
      tx.knowledgeTopic.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.savedArticle.delete.mock.invocationCallOrder[0]);
  });

  it('does not revise or delete another owner’s article', async () => {
    const { tx, service } = setup();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'owner' }])
      .mockResolvedValueOnce([]);
    await expect(service.remove('owner', 'foreign')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.knowledgeTopic.updateMany).not.toHaveBeenCalled();
    expect(tx.savedArticle.delete).not.toHaveBeenCalled();
  });
});
