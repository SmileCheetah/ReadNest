# Rich Markdown 요약 문제 해결 기록

## 확인일

2026-09-08

## 해결된 항목

- V2 JSON Schema에 `schemaVersion`과 `summaryMarkdown`을 추가했다.
- 허용되지 않은 HTML, iframe, 이미지, 표, 코드 펜스, 위험 링크, 잘못된 heading,
  중복 문단, 빈 값, 16,000자 초과 출력을 런타임에서 거부한다.
- V2 검증 실패 시 기존 fallback 경로를 사용한다.
- 기존 구조화 필드와 `summary`/`summaryMeta` 저장은 기존처럼 한 번의 Prisma update로 수행된다.
- Node.js 실행 기준을 `.nvmrc`의 22로 명시했다. `openai@7.10.0`의 엔진 요구사항과 일치한다.
- `summaryGeneration`을 추가해 재시도마다 generation을 증가시키고, worker가 오래된 job 결과를 건너뛰도록 했다. BullMQ jobId에도 article과 generation을 포함한다.
- 정상/비정상 Markdown 검증 테스트를 추가했고 build, test, lint를 통과시켰다.

## 아직 추가 작업이 필요한 항목

- OpenAI timeout·429·5xx와 V2 fallback 통합 테스트는 실제 OpenAI client mocking 경계가
  정해진 뒤 추가해야 한다.
- Python golden fixture, 번호·항목 순서 및 대조 논리 보존 검사는 모델 출력 평가 fixture가
  필요하다. 현재 validator는 형식만 검증하며 의미 보존을 자동 판정하지 않는다.
- 중복 worker 방지는 generation guard로 보완했으며 migration 적용이 필요하다. 동일 generation의
  동시 worker까지 완전히 직렬화하려면 추가 분산 락 검토가 필요하다.
- DB update 호출 횟수는 코드상 단일 update이나, Prisma mock 기반 processor 통합 테스트가
  필요하다.
- `npm audit --omit=dev` 결과 low 1, moderate 1, high 5 취약점이 확인됐다. NestJS/Prisma
  전이 의존성 영향이 포함되어 있어 major upgrade 전 별도 검토가 필요하다.
- 원격 push는 현재 인증 상태와 작업 브랜치 정책 확인 후 수행해야 한다. main 직접 push는 하지 않는다.

## 검증 결과

- `npm ci`: 성공
- `npm run build`: 성공
- `npm test -- --runInBand`: 3 suites / 13 tests 성공
- `npm run lint`: 오류 0, 기존 floating promise 경고 1
