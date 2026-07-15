import { ConfigService } from '@nestjs/config';
import { ContentExtractorService } from './content-extractor.service';

describe('ContentExtractorService', () => {
  const service = new ContentExtractorService(new ConfigService());
  const cleanThreadsText = (text: string) =>
    (
      service as unknown as {
        cleanThreadsText(value: string): string;
      }
    ).cleanThreadsText(text);

  it('keeps numbered author replies and stops before related threads', () => {
    const result = cleanThreadsText(`
스레드
조회 1만회
wakeupmoon.ai
15시간
메인 글입니다.
wakeupmoon.ai
15시간
·
작성자
1. 첫 번째 주장
첫 번째 설명입니다.
wakeupmoon.ai
15시간
·
작성자
17. 결론
마지막 설명입니다.
관련 스레드
다른 사용자의 글
`);

    expect(result).toContain('메인 글입니다.');
    expect(result).toContain('1. 첫 번째 주장');
    expect(result).toContain('17. 결론');
    expect(result).not.toContain('다른 사용자의 글');
    expect(result).not.toContain('작성자');
  });

  it('stops before the login wall', () => {
    const result = cleanThreadsText(`
메인 글입니다.
로그인하여 더 많은 답글을 확인해보세요.
로그인 화면 설명
`);

    expect(result).toBe('메인 글입니다.');
  });
});
