/* Jest asymmetric matchers and intentionally minimal persistence fakes. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ClassificationService } from './classification.service';
import { QueueSafetyService } from '../queue/queue-safety.service';
import {
  parseClassification,
  validateCategories,
} from './classification-input';

const result = {
  kind: 'ARTICLE',
  categories: ['개발'],
  projectName: '',
  useCase: '',
  evidence: '코드와 테스트',
};
function setup() {
  const prisma = {
    savedArticle: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    articleClassification: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const queue = { add: jest.fn(), on: jest.fn() };
  const safety = new QueueSafetyService();
  const service = new ClassificationService(
    prisma as never,
    { get: () => undefined } as never,
    queue as never,
    safety,
  );
  return { prisma, queue, service, safety };
}
describe('classification contract', () => {
  it('blocks repeated classification enqueue after quota without changing saved data', async () => {
    const s = setup();
    s.prisma.savedArticle.findUnique.mockResolvedValue({
      rawText: '원문',
      resultGeneration: 2,
      processStatus: 'SUMMARY_DONE',
      classification: {
        userEdited: false,
        sourceGeneration: 2,
        state: 'PENDING',
      },
    });
    s.prisma.articleClassification.findUnique.mockResolvedValue({
      userEdited: false,
      sourceGeneration: 2,
      state: 'PENDING',
      revision: 1,
    });
    s.queue.add.mockRejectedValue(
      new Error('ERR max requests limit exceeded.'),
    );
    expect(await s.service.schedule('a')).toBe(false);
    expect(await s.service.schedule('a')).toBe(false);
    expect(s.safety.isQuotaBlocked).toBe(true);
    expect(s.queue.add).toHaveBeenCalledTimes(1);
    expect(s.prisma.articleClassification.updateMany).not.toHaveBeenCalled();
  });
  it('accepts multiple topics and exact source evidence', () => {
    expect(
      parseClassification(
        { ...result, categories: ['개발', 'AI·기술', '개발'] },
        '코드와 테스트를 AI로 작성한다.',
      ).categories,
    ).toEqual(['개발', 'AI·기술']);
  });
  it('keeps unknown separate and rejects invented categories and evidence', () => {
    expect(
      parseClassification(
        { ...result, kind: 'UNCLASSIFIED', categories: [], evidence: '' },
        '안녕하세요',
      ).kind,
    ).toBe('UNCLASSIFIED');
    expect(() => parseClassification(result, '주식 이야기')).toThrow(
      'UNSUPPORTED_CLASSIFICATION',
    );
    expect(() => validateCategories('OPEN_SOURCE', ['경제·금융'])).toThrow();
    expect(() => validateCategories('ARTICLE', [])).toThrow();
  });
  it('requires named project and use case for open source', () => {
    expect(() =>
      parseClassification(
        { ...result, kind: 'OPEN_SOURCE', categories: ['개발 도구'] },
        'Demo 코드와 테스트',
      ),
    ).toThrow('INVALID_PROJECT');
    expect(
      parseClassification(
        {
          ...result,
          kind: 'OPEN_SOURCE',
          categories: ['개발 도구'],
          projectName: 'Demo',
          useCase: '코드 검사',
        },
        'Demo 코드와 테스트',
      ).projectName,
    ).toBe('Demo');
  });
  it('never schedules user corrections', async () => {
    const s = setup();
    s.prisma.savedArticle.findUnique.mockResolvedValue({
      rawText: '원문',
      resultGeneration: 2,
      processStatus: 'SUMMARY_DONE',
      classification: { userEdited: true },
    });
    expect(await s.service.schedule('a')).toBe(false);
    expect(s.queue.add).not.toHaveBeenCalled();
  });
  it('guards claims against duplicate workers', async () => {
    const s = setup();
    s.prisma.articleClassification.updateMany.mockResolvedValue({ count: 0 });
    const generate = jest.spyOn(s.service, 'generate');
    await s.service.process({
      articleId: 'a',
      revision: 1,
      sourceGeneration: 2,
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it('guards late model results against source changes and user corrections', async () => {
    const s = setup();
    s.prisma.savedArticle.findUnique.mockResolvedValue({
      rawText: '코드와 테스트',
      resultGeneration: 2,
    });
    jest
      .spyOn(s.service, 'generate')
      .mockResolvedValue(parseClassification(result, '코드와 테스트'));
    await s.service.process({
      articleId: 'a',
      revision: 1,
      sourceGeneration: 2,
    });
    expect(s.prisma.articleClassification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          articleId: 'a',
          revision: 1,
          userEdited: false,
          sourceGeneration: 2,
          leaseToken: expect.any(String),
          article: { resultGeneration: 2 },
        }),
        data: expect.objectContaining({ state: 'SUCCEEDED' }),
      }),
    );
  });
  it('records classification failure without changing the saved summary', async () => {
    const s = setup();
    s.prisma.savedArticle.findUnique.mockResolvedValue({
      rawText: '코드와 테스트',
      resultGeneration: 2,
    });
    jest.spyOn(s.service, 'generate').mockRejectedValue(new Error('timeout'));
    await s.service.process({
      articleId: 'a',
      revision: 1,
      sourceGeneration: 2,
    });
    expect(s.prisma.articleClassification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'FAILED' }),
      }),
    );
  });
  it('rejects edits and retries on another user article', async () => {
    const s = setup();
    s.prisma.savedArticle.findFirst.mockResolvedValue(null);
    await expect(
      s.service.edit('u', 'foreign', {
        kind: 'ARTICLE',
        categories: ['개발'],
        revision: 1,
      }),
    ).rejects.toThrow('저장한 글을 찾을 수 없습니다.');
    await expect(s.service.retry('u', 'foreign')).rejects.toThrow();
  });
  it('rejects stale manual edits', async () => {
    const s = setup();
    s.prisma.savedArticle.findFirst.mockResolvedValue({ resultGeneration: 1 });
    s.prisma.articleClassification.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      s.service.edit('u', 'a', {
        kind: 'ARTICLE',
        categories: ['개발'],
        revision: 1,
      }),
    ).rejects.toThrow('분류가 변경됐어요');
  });
  it('filters by owner and open source use case with bounded pagination', async () => {
    const s = setup();
    await s.service.list('u', { kind: 'OPEN_SOURCE', category: '개발 도구' });
    expect(s.prisma.savedArticle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u',
          classification: {
            is: {
              kind: 'OPEN_SOURCE',
              categories: { array_contains: '개발 도구' },
            },
          },
        },
        take: 31,
      }),
    );
  });
  it('keeps uncategorized articles visible in the article tab', async () => {
    const s = setup();
    await s.service.list('u', { kind: 'ARTICLE' });
    expect(
      s.prisma.savedArticle.findMany.mock.calls[0][0].where.OR,
    ).toContainEqual({ classification: { is: null } });
  });
});
