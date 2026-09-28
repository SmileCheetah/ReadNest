# Unwind 제품·UX 구현 기록

- 시작일: 2026-09-29
- 기준 계획: [제품·UX 개선 계획](PRODUCT_UX_IMPROVEMENT_PLAN.md)
- 시작 커밋: `ec8e638`
- 작업 브랜치: `codex/product-ux-reliability`
- 상태: 핵심 신뢰성·읽기 UI 구현, 자동/격리 통합/웹 화면 검증 완료. 실제 기기·AI 품질·운영 출시 게이트는 미완료이며 아래에서 분리한다.
- 검증 대상 코드 커밋: Backend `cf0a6e0`, Frontend `0362caf`. 설계 잠금/공유 fixture는 `35b7226`.

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
- 공개 응답의 `retryable`은 **수동 재요약 가능 여부**다. 자동 backoff 여부와 다르며, 진행 중이 아니고 cooldown/시간창 한도가 풀렸을 때 true다. `INVALID_MARKDOWN`은 자동 재시도하지 않지만 수동 재생성할 수 있다.
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

| 검사 | 실제 결과 |
| --- | --- |
| Backend build | 통과 |
| Backend 자동 테스트 | **10 suites / 85 tests 통과** |
| Backend lint | 오류 0, 기존 `main.ts` floating promise 경고 1 |
| Mobile typecheck | 통과 |
| Mobile 자동 테스트 | **6 suites / 60 tests 통과**. 로컬 Watchman recrawl 경고는 있으나 테스트 실패 없음 |
| MySQL/Redis 통합 | **10개 시나리오 통과**, mocked AI 5회, 외부 모델 호출 0 |
| migration | 격리 MySQL에 최종 3개 migration 신규 적용 성공. 구 schema의 완료·SAVED·SUMMARIZING fixture upgrade도 확인 |
| 웹 실제 렌더 | Chrome/Expo web 390×844, 320×740. 제목 한 번·가로 overflow 없음·첫 입력 기본 닫힘·늦은 완료 반영·보관함 진입·긴 문서 접기/전체 펼침 통과 |
| 디자인 계약 | StyleSeed resolve `--check`, 수동 코드/픽셀 리뷰 통과. 공식 ss-score/ss-verify 점수 없음 |
| 실제 공개 링크 수집만 | 요청했던 aicoffeechat 게시글 수집 1회: 브라우저 경로 실패, bounded HTTP metadata **FALLBACK_SUCCESS / PARTIAL, 1,581자, 약 12.3초**. AI 미호출. 이후 짧은 글/route 경계 최종 보완은 자동 테스트로 검증했으며 이 수치는 최종 코드의 완전 수집 보장 아님 |
| 실기기/실제 모델/운영 | 수행하지 않음. 사용자 DB migration·운영 서버 재기동도 수행하지 않음 |

격리 통합 시나리오: URL·인증 경계, 동시 중복 저장, 완료 글 중복 저장 보존, 동일 key 재요약/원문 누적 방지, 수집 실패 시 기존 본문/모델 호출 수 보존, cursor·계정 소유권·가벼운 status, 생성 중 삭제, queue 전송 실패 후 복구, 만료 lease·동시 claim·오래된 worker 거부, **105개 과거 글의 동일 savedAt cursor/preview/누락·중복 없음**.

합성 목록 105개를 40/40/25개로 읽은 응답은 각각 29,698 / 29,693 / 18,394 bytes, 로컬 요청 시간 9 / 7 / 7ms였다. 운영 p95가 아니며 cold cache·네트워크·부하 조건을 대표하지 않는다. 신규 preview가 있는 목록은 1회 조회, 과거 null preview가 있는 페이지는 owner-scoped 본문 조회 1회를 추가하며 N+1/추가 AI/DB 쓰기는 없다.

새 필드 초기화가 기존 요약을 삭제하지 않는지, SAVED/SUMMARIZING이 generation 0의 PENDING task로 복구되는지, requestKey가 `utf8mb4_bin`으로 대소문자를 구분하는지 확인했다. 검증용 MySQL/Redis는 별도 loopback 포트와 임시 데이터 디렉터리만 사용했고 검사 후 종료했다. 통합 검사의 합성 계정은 정리했으며 사용자 서버/DB는 종료·초기화하지 않았다.

화면 증거는 합성 예시 콘텐츠이며 실제 Luna 출력이 아니다:

- [홈 390px](assets/product-ux-20260929/home-390.png)
- [상세 390px](assets/product-ux-20260929/detail-390.png)
- [상세 320px](assets/product-ux-20260929/detail-320.png)
- [긴 문서 320px](assets/product-ux-20260929/long-collapsed-320.png)
- [브라우저 검사 기록](assets/product-ux-20260929/report.json)

본문/보조 정보 대비를 점검했다. 흰색 위 브랜드 파랑 4.57:1, muted 5.92:1, faint 5.02:1, amber badge 6.33:1, red badge 5.65:1. 작은 파란 글씨가 blueSoft 위에 놓일 때는 더 진한 `primaryPressed`를 적용했다. 실제 네이티브 확대/스크린리더 검증은 남아 있다.

사용자 DB migration/reset/seed, 서버 재시작, 유료 모델 호출, 운영 배포는 별도 승인·환경 확인 없이 수행하지 않는다. migration 파일 작성과 Prisma client 생성은 실제 DB 적용과 다르다.

## 구현 범위

| 계획 영역 | 코드 변경 | 검증/제한 |
| --- | --- | --- |
| FE 상태·읽음 | 정규화 cache와 요청 hook, 지속 상태 조회, 계정/요청 세대 검사, AbortController, 글별 읽음 PATCH 직렬화, 실패 후 마지막 수동 의도 재동기화 | 45초 이후 완료·이전 계정/검색 응답·수동 읽음·동일 retry key 회귀 |
| 수집 안전성 | Threads HTTPS 정규화, redirect/DNS 공인 IP 확인 및 주소 고정, 브라우저 하위 요청 제한, 시간/용량 예산, 빈 원문 gate | 허용 출처 밖 요청 거부. 전체 연속 글 확보를 보장하지는 않음 |
| 작업 정합성 | DB 수락+task 원자 기록, dispatcher, generation/lease CAS, heartbeat, checkpoint, 제한 retry | at-least-once 전달/멱등 저장. 외부 AI 호출 exactly-once 보장 아님 |
| 원문·요약 | 새 원문 snapshot, 마지막 정상 본문 보존, 부가 감지 실패 격리, 제목 길이 제약 | 프롬프트·모델 기본값·본문 문장/항목 수는 변경 없음 |
| 홈·보관함 | 다시 볼 글 우선, 섹션 중복 제거, 상태별 안내, 전체 기간 기본, 검색/읽음 필터, cursor FlatList | 상세 뒤로가기에서 보관함 유지. 미로드 항목 자동 발견 한계는 아래 참조 |
| 상세 읽기 | 제목 한 번, 도입/액션/본문, 평면 Markdown, 번호·줄바꿈·연속 접기, 복사/에러/메뉴 포커스 | 네이티브 스크린리더 검증과 별개 |
| 기존 데이터 | migration이 완료 본문 메타/작업 중 task를 보존·보충, 기존 preview는 본문에서 계산 | 원문·요약 재생성이나 사용자 데이터 삭제 없음 |

### 구현값과 복구 경계

- worker 동시성 2, lease 90초, heartbeat 20초, dispatcher 주기 5초. lease 만료 작업은 attempts 한도 내 다시 대기시킨다.
- task 자동 시도 최대 2회, 3초 기반 지수 backoff+jitter 및 공급자 Retry-After 적용. 모델 SDK 자체 재시도는 끄고 작업 레벨에서 통제한다. 모델 timeout 120초.
- Redis 전송이 지연돼도 DB 수락 응답은 기다리지 않는다. dispatcher 대기 3초와 task별 미완료 enqueue 추적으로 offline 명령 누적을 제한한다.
- 성공 후 저장 실패 복구에는 DB에 남긴 checkpoint를 사용한다. 응답 수신 직후 checkpoint 이전 프로세스 종료는 AI 재호출 가능성이 남는다.
- 수동 재요약 기본 한도는 글별 1시간 3회(`SUMMARY_RETRY_LIMIT`, `SUMMARY_RETRY_WINDOW_SECONDS`). 기존 영구 누적 한도 대신 창이 지나면 다시 가능하다. 저장 quota는 Asia/Seoul 날짜와 사용자 행 잠금으로 경쟁을 막는다.
- 원문 응답별 2MB, 수집 전체 8MB/45초, 요청별 최대 8초, redirect 3회, 브라우저 scroll 최대 5회, 추출 본문 50,000자. 보안·자원 한도이며 요약 내용을 특정 항목 수로 압축하는 정책이 아니다.
- 일반 API 오류/화면에는 SQL·키·원시 공급자 오류를 쓰지 않는다. 내부 로그는 article ID/generation/errorCode/전체 처리 elapsedMs 중심이다.

## 리뷰에서 발견하고 보완한 사항

1. 경량 목록에서 새 resultGeneration만 먼저 오면 이전 본문을 새 결과로 오인할 수 있었다. 본문 세대를 유지하고 `documentStale` 표시 후 상세를 재조회한다.
2. 자동 재시도 정책과 수동 `retryable`의 의미가 달랐다. 외부 계약은 사용자 행동 가능 여부로 통일했다.
3. migration이 기존 처리 중 글을 작업 레코드로 연결하지 않으면 영구 대기할 수 있었다. generation 0의 durable task를 보충한다.
4. Redis offline enqueue가 저장 응답을 막을 수 있었다. DB 수락과 전송을 분리하고 대기 시간을 제한했다.
5. 단계 변경의 lease 검사와 쓰기 사이 경합을 트랜잭션 CAS로 묶었다.
6. 실제 브라우저 확인으로 기존 사용자에게도 저장 입력 패널이 자동 열리는 초기 loading 경합을 발견했다. 첫 성공 응답 후에만 새 사용자 여부를 판단하도록 고치고 수동 입력/공유 링크는 유지한다.
7. 독립 리뷰에서 짧은 정상 원문 실패와 과거 글 preview 누락을 발견했다. 게시글 메타 증거로 짧은 글을 허용하고 과거 preview는 bounded batch로 계산하며 회귀/통합 테스트를 추가했다.

`App.tsx` diff에는 상태 hook 분리·홈/보관함 교체 외에 미사용 과거 상세 스타일 제거와 formatting이 포함된다. 과거 3포인트 요약 화면은 재도입하지 않는다. 새로운 런타임/Markdown 의존성은 추가하지 않았다.

## 적용 순서와 rollback

이번 변경은 **Prisma migration이 필요하다. main pull만으로 실행 환경이 완성되지 않는다.** 아래는 운영자가 적용할 runbook이며 이 작업에서 사용자 DB에 실행한 명령이 아니다.

1. 대상 checkout/배포 SHA, API/모바일의 실제 연결 주소, DB/Redis 대상과 backup을 확인한다. 로그에 `.env` 또는 키를 출력하지 않는다.
2. 구 API의 새 저장/재요약 수락을 일시 중단하고 **모든 구 worker를 drain/종료한다.** 구 worker에는 generation CAS가 없으므로 신·구 버전을 동시에 실행하는 rolling 전환은 안전하지 않다. 프론트만 재시작해서 해결할 수 있는 변경이 아니다.
3. API 경로에서 프로젝트 Node 버전으로 `npm ci`, `npm run prisma:generate`, `npm run prisma:migrate:deploy`, `npm run build`를 수행한다. migration은 새 필드와 task table을 추가하고 기존 성공 본문은 유지한다.
4. 새 API/worker를 한 버전으로 기동한다. 구 형식 BullMQ job은 새 worker가 실행하지 않으며 DB backfill task가 기존 대기를 복구한다. Redis queue를 무작정 지우지 않는다.
5. 저장→QUEUED→EXTRACTING→GENERATING→PERSISTING→DONE/실패, 처리 중 재요청, 기존 본문 보존, 읽음·cursor 조회를 smoke test한다. 사용자 재요약은 명시 요청한 글만 한다.
6. 해당 API 계약을 사용하는 모바일 번들을 새로 로드/빌드한다. 개발용 Metro가 오래된 번들을 쓰면 작업 경로를 확인하고 `npx expo start -c`로 다시 실행한다. 이미 배포한 설치 앱은 별도 업데이트가 필요하다.
7. 문제가 있으면 신규 수락과 새 worker를 먼저 멈추고 task 상태/로그를 보존한다. additive schema는 즉시 drop하지 않는다. **구 worker 단순 재기동은 새 task/세대 계약을 모르므로 안전한 rollback이 아니다.** 영향 task와 backup을 확인해 수정 버전 배포 또는 승인된 복구 절차를 택한다.

## 재현 방법

일반 검사:

```sh
# readnest-api
npm run build
npm test -- --runInBand
npm run lint
# readnest-mobile
npm run typecheck
npm test -- --runInBand
```

격리 워크플로 검사는 `readnest-api/scripts/verify-summary-workflow.cjs`를 사용한다. 로컬 MySQL **13307**, DB **readnest_qa**, Redis **16379**, `READNEST_ISOLATED_QA=1`이 아니면 실행을 거부한다. 새 테스트 계정만 생성·정리하며 원문 수집/AI/부가 감지만 fake provider다. 실제 API 인증·DB·queue·worker 경로를 실행한다. 운영 DB URL을 전달하지 않는다.

브라우저 검사는 `readnest-mobile/scripts/verify-ux.mjs`를 사용한다. 로컬 Expo web 8097을 띄우고 Chrome/Playwright로 합성 API를 주입한다. 모든 `/api/` 요청을 가로채 실제 서버에 테스트 로그인을 보내지 않는다. Metro CI 모드는 watch를 끄므로 코드 변경 후 테스트 preview를 다시 시작해야 한다. 기본 출력은 `/tmp/readnest-ux-verification`이며 실제 네이티브 검증으로 간주하지 않는다.

## 남은 출시 게이트

- **실기기:** Android/iOS의 200% font scale, TalkBack/VoiceOver, 모달 포커스, native 복사·공유·네트워크 복귀·설치 빌드 링크 수신. 웹 320px 통과는 이 항목의 대체가 아니다.
- **원문 완전성:** 같은 작성자/루트의 모든 parts 수집은 아직 입증하지 않는다. 긴 본문/마지막 번호만으로 COMPLETE라고 선언하지 않는다. 브라우저 수집이 제한되면 메타 기반 부분 요약 또는 수집 실패가 가능하다.
- **실제 AI/회상 평가:** 이번에는 유료 Luna 호출을 하지 않았다. mock 응답 검증이 실제 요약 품질 보장은 아니다. 계획의 20개 평가셋과 사용자 10초 회상 테스트는 별도 진행한다.
- **공개 노출:** 가입/로그인 endpoint rate limit, 사용자별 동시 작업·AI 비용 예산, abuse 대응은 배포 인프라 포함 추가 검증이 필요하다. 저장 quota와 worker 동시성만으로 충족하지 않는다.
- **성능/계측:** 현재 로그·작업 레코드는 진단 기반이다. 전체 단계 p50/p95 대시보드, 실행 계획 분석, 부하/비용 SLO는 아직 미측정이다. 격리 synthetic 목록 응답 측정은 운영 벤치마크가 아니다.
- **목록 범위:** 모바일은 저장/로드로 알게 된 pending을 모두 추적하지만 첫 30건 밖 아직 로드되지 않은 작업을 별도 검색하지 않는다. 오래된 미완료 글은 보관함에서 페이지를 불러오면 추적한다.
- **다중 기기:** 읽음 쓰기는 한 클라이언트에서 직렬화한다. 다중 기기 경쟁은 서버 revision/CAS 계약으로 확장해야 한다.
- **데이터 유지:** terminal task에는 checkpoint 본문을 지우지만 멱등 키·task 이력 retention 정책은 후속 운영 과제다. 기존 URL 중복 행을 삭제/통합하지 않았다.
- BYOK, Java 이관, 별도 AI 축약 요약, 신규 share target, 삭제 실행 취소는 이번 범위가 아니다.
