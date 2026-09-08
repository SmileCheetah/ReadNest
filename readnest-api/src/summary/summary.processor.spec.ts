/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ProcessStatus } from '@prisma/client';
import { SummaryProcessor } from './summary.processor';

describe('SummaryProcessor summary persistence policy', () => {
  it('marks the job failed instead of saving a result without Markdown', async () => {
    const article = {
      id: 'article-1',
      userId: 'user-1',
      url: 'https://example.com/article',
      title: '제목',
      rawText: '저장된 원문',
    };
    const update = jest.fn().mockResolvedValue(article);
    const prisma = {
      savedArticle: {
        findUnique: jest.fn().mockResolvedValue(article),
        update,
      },
    };
    const contentExtractor = {
      extract: jest.fn().mockResolvedValue({
        title: '추출 제목',
        text: '추출 원문',
        extractionStatus: 'SUCCESS',
        extractionConfidence: 1,
      }),
    };
    const aiSummaryService = {
      summarize: jest.fn().mockResolvedValue({
        title: '제목',
        summary: '기존 요약',
        keyPoints: ['핵심'],
        tags: ['태그'],
        contextInsufficient: false,
        meta: {
          summaryType: '기타',
          title: '제목',
          oneLineSummary: '한 줄',
          coreSummary: '핵심',
          keyPoints: ['핵심'],
          conclusion: '',
          tags: ['태그'],
          readingValue: '',
          caution: '',
          contextStatus: '완결',
          threadStatus: '해당 없음',
          confidence: 0.8,
        },
      }),
    };
    const processor = new SummaryProcessor(
      prisma as never,
      contentExtractor as never,
      aiSummaryService as never,
      { detectAndLink: jest.fn() } as never,
    );

    await expect(
      processor.process({
        data: { articleId: article.id },
        opts: { attempts: 1 },
        attemptsMade: 0,
      } as never),
    ).rejects.toThrow('요약 형식');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processStatus: ProcessStatus.SUMMARY_FAILED,
        }),
      }),
    );
  });
});
