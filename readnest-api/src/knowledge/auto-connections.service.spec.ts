import { rankCandidates, verifiedLinks } from './auto-connections.service';

const candidates = [
  {
    id: 'b',
    title: '데이터 설계',
    rawText: '데이터의 정합성은 금융 서비스에서 중요하다.',
    resultGeneration: 1,
  },
  {
    id: 'c',
    title: '음식 이야기',
    rawText: '오늘은 바나나를 먹었다.',
    resultGeneration: 1,
  },
];

describe('automatic connections evidence gate', () => {
  it('accepts an actual two-sided source excerpt', () => {
    const result = verifiedLinks(
      '데이터 정합성 문제는 초기에 해결해야 한다.',
      candidates,
      {
        links: [
          {
            articleId: 'b',
            type: 'COMPLEMENT',
            reason: '두 글 모두 데이터 정합성의 중요성을 설명한다.',
            sourceEvidence: '데이터 정합성 문제는 초기에 해결해야 한다.',
            relatedEvidence: '데이터의 정합성은 금융 서비스에서 중요하다.',
          },
        ],
      },
    );
    expect(result).toHaveLength(1);
    expect(result[0].candidate.id).toBe('b');
  });

  it('rejects invented or unknown evidence without creating a link', () => {
    const result = verifiedLinks(
      '데이터 정합성 문제는 초기에 해결해야 한다.',
      candidates,
      {
        links: [
          {
            articleId: 'b',
            type: 'SIMILAR',
            reason: '근거가 없다면 연결해서는 안 된다.',
            sourceEvidence: '원문에 없는 거짓 문장입니다.',
            relatedEvidence: candidates[0].rawText,
          },
          {
            articleId: 'unknown',
            type: 'SIMILAR',
            reason: '다른 사용자 글과 연결해서는 안 된다.',
            sourceEvidence: '데이터 정합성 문제는 초기에 해결해야 한다.',
            relatedEvidence: candidates[0].rawText,
          },
        ],
      },
    );
    expect(result).toEqual([]);
  });

  it('keeps only three unique verified connections', () => {
    const source = '데이터 정합성 문제는 초기에 해결해야 한다.';
    const link = {
      articleId: 'b',
      type: 'SIMILAR',
      reason: '두 글 모두 데이터 정합성을 다룬다.',
      sourceEvidence: source,
      relatedEvidence: candidates[0].rawText,
    };
    expect(
      verifiedLinks(source, candidates, { links: [link, link] }),
    ).toHaveLength(1);
  });
});

describe('candidate selection', () => {
  it('prefers overlapping raw concepts without generating a topic', () => {
    expect(rankCandidates('금융 서비스 데이터 정합성', candidates)[0].id).toBe(
      'b',
    );
  });
});
