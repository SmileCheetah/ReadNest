# Unwind 제품·UX 구현 기록

- 시작일: 2026-09-29
- 기준 계획: [제품·UX 개선 계획](PRODUCT_UX_IMPROVEMENT_PLAN.md)
- 시작 커밋: `ec8e638`
- 작업 브랜치: `codex/product-ux-reliability`
- 상태: 구현 중. 아래 계약은 이번 구현의 합의이며 통과 결과는 검증 후 기입한다.

## 범위와 성공 조건

단일 Markdown 본문을 유지하면서 저장·요약·화면 반영·읽음·재발견을 개선한다. 프롬프트에 고정 항목 수나 추가 압축을 넣지 않는다. 같은 글의 중복 실행, 이전 요청의 덮어쓰기, 부가 처리 오류로 정상 결과를 잃는 상황을 회귀 테스트한다.

Frontend는 상태 추적/요청 순서/오프라인 세션과 홈·보관함을 한 작업 단위로, Markdown renderer/상세 읽기 흐름을 다른 작업 단위로 구현한다. Backend는 수집 검증·작업 정합성·목록 API를 담당한다. Tech Lead가 공통 계약, 통합 테스트, 디자인 검증, 전체 diff 및 릴리스 상태를 검토한다.

## API 합의

- 기존 `processStatus`, 읽음 API, `summaryMeta.summaryMarkdown` 본문을 유지한다.
- Article 및 상태에 추가하는 필드: `generation`, `resultGeneration`, `generatedAt`, `stage`, `errorCode`, `retryable`, `retryAfterSeconds`, `summaryPreview`, `sourceCompleteness`.
- `stage`: `QUEUED | EXTRACTING | GENERATING | PERSISTING | DONE | FAILED`.
- `sourceCompleteness`: `UNKNOWN | PARTIAL | COMPLETE`. 수집 증거 없는 완결 선언 금지.
- `GET /api/articles?pagination=cursor&cursor=...`는 `{ items, nextCursor }`. opt-in하지 않은 기존 목록은 배열 계약 유지.
- cursor 목록은 전체 Markdown/rawText를 포함하지 않는 경량 자료다. 상세 진입 시 상세 API를 조회하며, 목록 자료를 완전한 상세 객체로 덮어쓰지 않는다.
- 중복 저장은 기존 article 반환. 처리 중 재시도는 기존 generation 반환. 정상 결과가 있는 재요약은 이전 본문을 보존하고 최신 성공 결과로만 교체한다.
- 요약 생성/재시도 POST는 optional `Idempotency-Key` 헤더(최대 128자)를 지원한다. 글 ID별로 구분하며, 네트워크 재전송에는 같은 키, 사용자가 새로 요청한 재요약에는 새 키를 쓴다. 헤더 없는 구 앱은 처리 중 중복을 막는다.
- 서버가 추가 필드를 제공하기 전에도 모바일은 안전하게 동작해야 한다. 오래된 서버의 오류/미지원 pagination은 사용자에게 조회 복구 안내를 제공한다.

## 중요한 판단

**문제 →** 상태 반영 누락과 프롬프트 품질 문제가 섞여 진단이 어려웠다. **선택지 →** 모델 교체/프롬프트 추가, 처리 흐름 수정. **선택 →** 프롬프트 유지·파이프라인 및 표시 개선. **이유 →** 실제 원문과 저장 결과를 신뢰할 수 있어야 요약 품질을 평가할 수 있다. **트레이드오프 →** 실제 모델 품질 평가는 별도 남는다.

**문제 →** 재요약 실패가 사용 가능한 내용을 감춘다. **선택지 →** 기존 내용 삭제, 두 버전의 화면, 마지막 성공 본문 유지. **선택 →** 같은 Markdown 문서를 보존하고 갱신 상태만 별도 안내. **이유 →** 사용자 데이터 손실 없이 복구 가능하다. **트레이드오프 →** 이전 결과의 생성 시점/세대를 구분해야 한다.

**문제 →** 디자인을 화면마다 다르게 수정할 위험. **선택지 →** 새 테마/개별 임의 스타일, 기존 브랜드의 공통 읽기 기준. **선택 →** `editorial-reading × product-ui × content/detail × native-mobile`, 기존 파란색과 시스템 산세리프 유지. **이유 →** 글이 중심이고 조작부는 보조여야 한다. **트레이드오프 →** 화려한 장식보다는 위계·간격·접근성에 집중한다.

디자인 잠금은 [STYLESEED.md](../STYLESEED.md), 생성된 규칙/출처는 `.styleseed/effective-rules.md`와 `.styleseed/manifest.json`에 보관한다. resolver 4.1의 legacy recipe 기본값 때문에 재생성 명령에는 `--recipe native-mobile --palette editorial-ink`를 명시한다. 전용 `ss-score`/`ss-verify` 스킬은 현재 설치되어 있지 않아 프로젝트 테스트·수동 코드 리뷰·실제 렌더 캡처로 대체하며 공식 점수 통과를 주장하지 않는다.

## 공통 Markdown 테스트

[공유 fixture](../fixtures/summary-markdown-contract.json)를 Frontend/Backend가 함께 사용한다. 문장 속 파이프는 허용하고 표·HTML·이미지·코드 펜스·Markdown 링크는 현재 계약대로 거부한다. 번호·강조·인용문·줄바꿈은 내용 순서를 바꾸지 않는다. 별도 길이/접기/렌더 테스트는 각 모듈에 둔다.

## 검증 기록

구현 진행 중이며 완료 결과는 최종 검증 후 이 절에 기록한다. 자동 검사, 격리 DB/queue 통합, 브라우저 렌더링, 실제 기기·스크린리더, 실제 모델 호출, main 반영, 배포를 분리해 보고한다.

사용자 DB migration/reset/seed, 서버 재시작, 유료 모델 호출, 운영 배포는 별도 승인·환경 확인 없이 수행하지 않는다. migration 파일 작성과 Prisma client 생성은 실제 DB 적용과 다르다.
