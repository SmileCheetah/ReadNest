# 오류 → 해결 기록

## 기록 원칙

- 오류 발견 시 먼저 기록하고 상태를 `미해결`로 둔다. 조사 중이면 `조사 중`으로 표시한다.
- 발생 증상, 확인된 사실, 추정 원인을 구분한다. 해결 후보를 실제 적용한 해결법처럼 쓰지 않는다.
- 해결되면 기존 오류 기록을 지우지 않고 **같은 항목 아래의 해결 방법**에 적용 내용과 검증 결과를 추가한다.
- 해결 날짜, 관련 커밋·PR, 배포·migration 여부, 재발 방지책을 남긴다. 실제 문제 환경의 복구를 확인한 후 `해결`로 변경한다.
- 비밀번호, API 키, 연결 문자열, 사용자 개인정보는 기록하지 않는다.
- 과거 상세 기록은 복사해 상태를 재해석하지 않고 연결한다: [Rich Markdown 문제 해결 기록](RICH_MARKDOWN_SUMMARY_PROBLEM_RESOLUTION.md), [요약 지연 조사](SUMMARY_LATENCY_INVESTIGATION.md).

## ERR-001 — Upstash Redis 월간 요청 한도 초과

- 기록일: 2026-10-10
- 상태: **개선 코드 로컬 검증 완료 / 운영 미해결**
- 환경: 사용자가 제공한 배포 서버 로그(`/app/node_modules`) 및 KoDeploy·Upstash 운영 콘솔 읽기 전용 조회. 정확한 배포 Git SHA와 replica 수는 미확인
- 우선순위: 높음 — 요약·요약 밀도 변경·자동 분류 큐 처리에 영향

### 오류

```text
ReplyError: ERR max requests limit exceeded.
Limit: 500000, Usage: 500004.
command: evalsha
```

로그에서 `summary`, `summary-variant`, `article-classification` 큐의 Redis 명령이 반복 거부된다. 전체 API나 DB가 중단됐는지는 이 로그만으로 판단하지 않는다.

### 확인된 사실

- 500,000은 요약 횟수나 사용자 수가 아니라 Redis 요청 한도다. 제공된 로그의 사용량은 500,004다.
- [Upstash 오류 설명](https://upstash.com/docs/redis/troubleshooting/max_requests_limit)에 따르면 월간 요청 한도 초과 오류다. 재배포나 앱 재시작만으로 사용 한도가 초기화되지 않는다.
- 현재 코드에 기본 요약, 밀도별 요약, 자동 분류의 BullMQ processor가 등록되어 있다.
- 로컬에 설치된 BullMQ 코드의 기본값은 `drainDelay: 5`(초), `stalledInterval: 30000`(밀리초)다. 운영에 설치된 버전·설정은 별도 확인이 필요하다.
- [Upstash BullMQ 안내](https://upstash.com/docs/redis/integrations/bullmq)는 큐에 작업이 없어도 Redis 요청이 발생한다고 설명한다.
- 제공된 로그에서 세 큐의 실패가 짧은 간격으로 반복된다. 이 오류 발생 후 재시도 패턴만으로 한도 소진 전의 요청률을 확정할 수 없다.

### 추정 원인 — 미확정

- 상시 실행 중인 worker의 작업 확인·상태 점검 요청 누적.
- 여러 서버 인스턴스나 개발·운영 환경이 같은 Redis를 사용해 사용량이 합산됐을 가능성.
- 실패 시 반복 호출이 과도할 가능성.

규모 설명용 예시: 5초마다 Redis 명령을 1회 보내는 처리기 1개라면 하루 17,280회, 30일 518,400회다. 이는 **실측값이나 실제 사용량 추산 결과가 아니다**. 실제 명령 수·과금 집계·가동 기간을 확인해야 한다.

### 조사 및 해결 후보 — 아직 미적용

1. Upstash 콘솔에서 요청량 추이, 요금제, 한도 갱신 시점을 확인한다.
2. 운영 replica 수, worker 수, 개발·운영 Redis 공유 여부를 확인한다.
3. 유휴 상태와 작업 처리 중의 요청량을 나누어 측정한다.
4. 불필요한 중복 worker와 반복 요청을 줄이고 한도 초과 시 재시도 간격·중단 정책을 검토한다. 큐 복구와 작업 지연에 미치는 영향도 검증한다.
5. 복구를 위한 요금제 변경 또는 Redis 이전은 비용·작업 보존·복구 절차를 검토하고 사용자 승인 후 진행한다. 데이터 삭제로 한도를 해결하려 하지 않는다.

### 해결 방법

**운영에서는 아직 해결되지 않음.** 최초 조사 때는 변경하지 않았으며, 이후 적용한 코드와 검증은 아래 `요청 절감·한도 차단 개선`에 기록한다. 요금제 변경, Redis 이전, 운영 재배포는 수행하지 않았다.

- 해결일: 미정
- 실제 적용 방법: 아래 로컬 코드 개선 기록 참조. 운영 한도 복구는 미적용
- 관련 커밋 / PR / 배포: 코드 기록은 Git 이력 참조. 운영 배포 미실시
- 검증: 세 큐의 처리 재개, 기존 미완료 작업의 안전한 복구, 중복 처리 여부, 유휴·작업 중 요청량 비교를 기록할 예정
- 재발 방지: 사용량 알림과 예상 월간 요청량 관리 방안을 적용 후 기록

### 2026-10-10 원인 조사 결과

1. **상시 worker 요청 확인:** `AppModule`이 `SummaryModule`과 `KnowledgeModule`을 항상 등록하고 각 모듈은 processor를 provider로 등록한다. 서버 프로세스마다 기본 요약·밀도별 요약·분류 worker가 시작되는 구조다. 운영 replica 수는 확인하지 못했으므로 중복 운영을 확정하지 않는다.
2. **로컬 측정:** 새 요약·분류 작업을 요청하지 않은 30.002초 동안 로컬 Redis `INFO commandstats` 차이를 관측했다. `BZPOPMIN` 15회, `EVALSHA` 18회가 발생했다. Lua 내부의 `HMGET`, `ZRANGE` 등도 통계에 잡히므로 전부 더해 외부 요청 수로 해석하지 않는다. 이 두 명령만 같은 속도로 지속된다는 가정이면 약 9.5만 회/일, 285만 회/30일이다. **운영 실측·Upstash 과금 수치가 아니며**, 다른 클라이언트의 영향과 운영 Redis의 blocking 동작 차이를 배제하지 않았다.
3. **오류 반복 원인 확인:** 설치된 BullMQ의 `Worker.mainLoop`는 `retryIfFailed`에 `onlyEmitError: true`를 전달한다. 한도 오류는 `isNotConnectionError`에서 연결 오류가 아닌 것으로 분류되어, `runRetryDelay: 15000` 대기 전에 오류를 emit하고 반환한다. worker 루프가 다시 요청할 수 있어, 항상 15초 후 재시도된다고 볼 수 없다. Redis 연결 없이 해당 메서드에 한도 오류를 넣는 단일 호출 재현에서 `emit=1`, `delay=0`을 확인했다. 제공 로그의 짧은 EVALSHA 반복 간격과 일치하는 경로다. 한도 소진 전 요청률의 증거는 아니다.
4. **개발 환경 분리 확인:** 현재 `readnest-api/.env`와 모바일 `.env.local`의 Redis 대상은 로컬이며 `REDIS_URL` 우선 설정은 없다. 실행 중 로컬 API PID 89728의 실제 Redis TCP 연결도 `::1:6379`였다. 따라서 이 로컬 API가 현재 Upstash를 직접 사용한다는 가설은 배제한다. 과거 설정·다른 개발 프로세스·운영 환경은 별도다. 비밀값은 출력·기록하지 않았다.
5. **5초 타이머 구분:** `SummaryJobService`와 `SummaryVariantJobService`의 5초 dispatch는 먼저 MySQL을 조회하고 PENDING 작업이 있을 때 Redis `queue.add`를 호출한다. 따라서 두 타이머의 모든 tick을 Redis 요청으로 세면 안 된다. PENDING 작업이 오래 남으면 재등록 시도는 추가 요청을 만들 수 있다. `attempts: 1`은 작업 실패 재시도 설정이지 worker의 Redis 조회 루프를 막는 설정은 아니다.

**1차 조사 결론:** 상시 worker의 요청이 제한을 소진할 수 있는 구조와, 한도 초과 후 오류가 빠르게 반복될 수 있는 경로를 확인했다. 이 시점에는 운영 콘솔을 확인하지 못했으며, 이후 브라우저에서 확인한 내용은 아래에 추가한다. 제품 코드·서버 설정은 변경하지 않았으며 상태는 미해결로 유지한다.

### ERR-001 추가 확인 — 운영 콘솔 브라우저 조회 (2026-10-10)

- 사용자 승인으로 KoDeploy를 읽기 전용 조회했다. `readnest`는 실행 중이며 최근 배포 #6은 main, 빌드 ID `dc2f4328`, 시작 2026-10-09 15:49, 소요 7분 3초, 성공으로 표시된다. 빌드 ID를 Git 커밋 SHA로 해석하지 않는다.
- 작업 공간에 같은 Redis 한도 오류가 표시되나 마지막 조회 시각은 16:01:04였다. 저장된 로그 표시만으로 조회 순간의 새 오류 발생을 단정하지 않는다.
- 설정에서 Dockerfile 방식·포트 3000을 확인했다. 조회한 화면에는 replica 수나 정확한 배포 Git SHA가 없어 확정하지 않았다.
- 최초 조회에서 Upstash 콘솔은 로그인 화면으로 이동하여 사용량 그래프를 조회하지 못했다. 이후 사용자가 로그인하여 아래 조사를 진행했다. 요금제, 환경변수, 서버 실행 설정은 변경하지 않았다.

### ERR-001 추가 확인 — 로그인 후 Upstash 사용량 조회 (2026-10-10)

`readnest-redis`의 Details와 Usage를 조회했다. 아래 시각은 콘솔 화면의 표시 기준이며, 주간 그래프의 시간대를 별도로 확정하지 않았다. 조회 기간은 `Past week`다.

| 항목 | 관측 결과 |
| --- | --- |
| 요금제·월간 한도 | Free Tier, 500,000 requests/month |
| 한도 안내 | 월간 요청 배너 497,292 / 500,000과 별도로 `You reached the free tier limit` 안내가 표시됨 |
| 읽기·쓰기 집계 | Reads 253,271 + Writes 244,021 = 497,292 |
| 10월 3일~4일 오전 처리량 | 약 1.81 commands/sec가 일정하게 관측됨 |
| 처리량 감소 구간 | 10월 4일 14:24 표본은 약 1.37/sec, 17:12 표본부터 거의 0 |
| TCP 연결 수 | 10월 9일 14:48 표본까지 3개, 17:36 표본부터 9개 |
| 저장 용량 | 관측 기간 약 7KB |
| 주요 명령 | Top Commands에 `EVALSHA`, `BZPOPMIN` 및 Lua 내부 명령과 겹치는 `DEL`, `HMGET` 등이 표시됨 |

#### 사실과 해석

1. **최근 배포 이전에도 정기적인 요청이 있었다.** KoDeploy의 직전 배포 #5는 9월 5일 16:54, 최근 배포 #6은 10월 9일 15:49로 표시된다. 10월 3~4일의 일정한 처리량과 이후 급감은 최근 배포 이전의 현상이다. 따라서 10월 9일 배포 직후 처음 50만 회를 사용했다고 설명할 근거는 없다.
2. **월 50만 한도와 상시 요청량의 불일치가 강하게 의심된다.** 관측된 1.81/sec를 단순 환산하면 하루 약 156,384회, 같은 속도로 50만 회에 도달하는 데 약 3.2일이다. 이는 규모 비교이며, 실제 월간 청구 요청량의 재구성이나 정확한 소진 날짜를 의미하지 않는다. 큐의 유휴 확인 패턴과 부합하지만, 전체 처리량이 BullMQ 유휴 요청만으로 발생했다고 확정하지 않는다.
3. **한도 소진 시점은 아직 추정이다.** 10월 4일 오후의 처리량 급감, 현재의 한도 도달 안내, 제공된 한도 오류는 이 무렵 소진됐을 가능성을 뒷받침한다. 하지만 배너의 497,292와 서버 오류의 500,004가 다르므로 집계 지연·범위 차이 여부를 확인해야 한다. 정확한 소진 시각, 거부된 명령의 집계 여부, Lua 내부 명령의 과금 집계 방식은 미확인이다. 처리량이 0이라고 해서 클라이언트의 실패 요청까지 멈췄다고 해석하지 않는다.
4. **연결 수 증가는 큐 추가와 구조적으로 일치한다.** Git의 9월 5일 `88ae9f8`, 9월 29일 이전 `6b93283` 스냅샷에는 summary 큐/worker 한 쌍만 있다. Queue 일반 연결과 Worker 일반·blocking 연결을 합한 3개 구조는 배포 전 관측과 맞고, 현재 세 큐/worker의 9개 연결은 배포 후 관측과 맞는다. 다만 연결 수만으로 실제 운영 replica 수나 배포 SHA를 확정할 수 없다. 현재 세 worker를 배포 전 최초 한도 소진의 원인으로 지목하지 않는다.
5. **저장 용량과 요청량은 별개다.** Redis 데이터가 약 7KB라는 사실은 월간 요청이 적다는 의미가 아니다. 글 데이터는 MySQL에 저장되며 큐 작업은 완료 후 제거되므로, Redis 용량으로 실제 사용자 작업 수를 추정하지 않는다.

#### 다음 해결 방향 — 아직 미적용

- 유휴 큐 확인 빈도와 불필요한 worker 실행을 줄이고, 작업 시작 지연·stalled 복구에 미치는 영향을 함께 측정한다.
- 한도 초과를 별도로 감지해 빠른 재시도 루프를 중단하거나 충분히 대기하도록 한다. `runRetryDelay`만 늘리는 것으로는 확인된 `EVALSHA` 오류 경로를 막지 못한다. `drainDelay` 조정도 유휴 정상 동작과 오류 재시도를 구분해 검증해야 한다.
- 요청량 절감과 별개로 이미 소진된 한도를 복구할 방법을 선택해야 한다. 요금제 변경·Redis 이전은 사용자 승인 후 진행하고 기존 작업의 보존·중복 실행을 검증한다. 재시작이나 재배포 자체는 한도를 복구하지 않는다.
- 운영 replica·실제 배포 버전 및 월간 집계 기준을 확인하여 사용량 예산과 알림 기준을 정한다.

**갱신된 결론:** 최근 배포 이전부터 누적된 정기적 Redis 요청과 월 50만 요청 한도의 불일치가 주요 원인으로 강하게 뒷받침된다. 한도 도달 후 빠르게 반복될 수 있는 오류 경로는 별도의 악화 요인이다. 정확한 요청 주체별 비중과 최초 소진 시각은 미확정이다. 이번에는 원인 조사와 문서만 갱신했으며, 결제·설정·제품 코드·서버 상태는 변경하지 않았다. 실제 복구 전까지 **미해결** 상태를 유지한다.

### ERR-001 요청 절감·한도 차단 개선 (2026-10-10)

#### 적용한 코드

- 세 worker에 공통 옵션을 적용했다. 빈 큐의 blocking 대기(`drainDelay`)는 5초에서 60초로, 멈춘 작업 확인(`stalledInterval`)은 30초에서 120초로 조정했다. 정상 작업의 lock duration/renewal, concurrency, 재시도 횟수는 변경하지 않았다. 새 작업의 marker가 들어오면 대기가 깨어나므로 60초 동안 무조건 기다리는 방식이 아니다. 지연 작업 경로와 운영 Redis의 동작은 별도로 관측해야 한다.
- 공통 `QueueSafetyService`와 `QuotaAwareWorkerHost`를 추가했다. `max requests limit exceeded`를 감지하면 해당 프로세스의 차단 상태를 유지하고 모든 등록 worker를 `close(true)`한다. 새 큐 등록도 로컬에서 차단한다. 한도 오류를 Redis에 다시 기록하거나 자동으로 복구 확인하지 않으므로 그 과정의 Redis 호출은 없다.
- `autorun: false`로 생성하고 Nest가 오류 핸들러를 연결한 뒤 bootstrap에서 시작한다. 먼저 한도를 감지했다면 나중에 등록되는 worker도 실행하지 않고 닫는다.
- 기본 요약·밀도별 요약의 DB PENDING 레코드는 삭제하거나 실패 처리하지 않는다. 차단 중에는 dispatch를 건너뛰며, 3초 enqueue 대기 timeout 뒤 늦게 도착한 한도 오류도 감지한다. 분류의 enqueue 실패는 저장된 요약을 실패로 바꾸지 않으며 복구 후 기존 scan/backfill 경로로 재등록할 수 있다.
- 일반 연결 오류·AI rate limit은 이 영구 차단 조건으로 취급하지 않는다. Redis 오류의 원문·명령 인자·비밀값을 새 로그에 출력하지 않는다.
- `/api/health`에 `queues.status` (`not_blocked` 또는 `quota_blocked`)와 `recoveryRequiresRestart`를 추가했다. **이 값은 프로세스 내부 차단 상태이며 Redis 연결 성공 보장이 아니다.** 상태 조회 때문에 Redis 요청을 추가하지 않는다. `/` liveness와 기존 HTTP 동작은 유지한다.
- 새 의존성·DB migration·프론트 변경은 없다. 기존 CJS QA 도구의 생성자 fixture도 새 guard에 맞춰 수정했다. 전체 lint를 막던 기존 AI service의 줄바꿈 1곳만 포맷 정리했으며 모델·요약 프롬프트는 변경하지 않았다.

#### 복구 절차와 주의사항

1. 운영 계정에서 한도/갱신 시점과 요금제를 확인한다. 용량·요금제 변경이나 Redis 이전은 사용자 승인 후 시행한다. **한도를 복구하지 않은 채 재시작을 반복하지 않는다.**
2. 코드 배포와 Redis 한도 복구가 준비되면 해당 Redis를 사용하는 백엔드 인스턴스를 재시작한다. 이 guard는 자동 재개하지 않으며, 이미 닫힌 worker에 `resume()`을 호출해서는 안 된다. 재시작은 차단 상태를 초기화할 뿐 월간 사용량을 초기화하지 않는다.
3. 로그의 `REDIS_QUOTA_EXCEEDED` 재발 여부와 `/api/health`의 queue 차단 상태를 확인한다. 이 상태만으로 자동 재시작을 걸지 말고 운영 알림으로 사용한다.
4. 기본 요약·밀도별 요약 각 1건, 분류 scan을 검증하고 DB 대기 작업/이전 checkpoint가 정상 처리되는지 확인한다. 기존 DB lease·generation·CAS 검증은 유지된다. 단위 테스트는 이 조건을 검증하지만 이번 작업에서 운영 MySQL의 실제 복구를 실행하지는 않았다.
5. 배포 후 유휴 시간과 실제 요약 처리 구간의 Upstash 요청량을 분리 관측한다. 최소 하루 사용량과 가동 인스턴스 수로 월간 예산을 재산정하고, 한도 접근 알림을 설정한다. 이는 후속 운영 작업이며 이번에 알림/요금제 설정을 변경하지 않았다.

`close(true)`는 진행 중인 AI 호출이나 processor 함수 자체를 취소하지 않는다. 이미 진행 중인 작업은 DB 저장을 끝낼 수 있으며, 전송 중이던 Redis 명령도 즉시 모두 취소된다고 보장하지 않는다. 종료 이후 반복 fetch·stalled 확인·lock renewal을 멈추는 것이 목적이다. 강제 종료된 작업의 회수는 기존 멱등 처리와 lease/checkpoint에 의존한다. `stalledInterval` 증가로 worker 장애 시 Redis 작업 회수가 수분 늦어질 수 있다. 차단 상태는 **프로세스별**이므로 다른 인스턴스도 각자 감지해야 한다.

#### 검증 및 남은 제한

- `npm run build`: 통과.
- `npm test -- --runInBand`: 20 suites / 181 tests 통과. 한도 감지·모든 worker 종료·늦은 등록/오류·일반 오류 구분·DB 대기 작업 보존·health 상태 및 기존 요약 회귀를 포함한다.
- 전체 ESLint: 오류 0건, 기존 `main.ts` floating promise 경고 1건. `git diff --check` 통과.
- 두 기존 CJS QA 스크립트는 문법 검사 및 변경된 생성자 fixture smoke test 통과. 이들의 별도 MySQL/유료 AI 통합 시나리오는 이번에 실행하지 않았다.
- `npm run test:queue-safety`는 독립된 임시 로컬 Redis를 생성해 실제 BullMQ 동작을 검증하는 opt-in 명령이다. `redis-server`가 필요하며 기존 Redis·운영 DB·API 키를 사용하지 않는다.
- 세 worker를 각각 약 125초간 유휴 상태로 두고 `INFO commandstats` 차이를 측정했다. 기존 옵션은 `BZPOPMIN` 72회 + `EVALSHA` 84회 = 156회, 변경 옵션은 각각 6회 + 9회 = 15회로 두 명령 합계가 약 90.4% 감소했다. 첫 시작/종료 및 실제 작업 명령은 이 구간에서 제외했고, Lua 내부 명령까지 합산하지 않았다. **Upstash 청구 요청량·월간 예측값이 아니다.**
- 변경 옵션에서 새 작업 enqueue부터 processor 진입까지 세 큐 각각 11ms / 1ms / 1ms였다. 로컬 무부하 측정이며 운영 지연의 보장은 아니다.
- 한도 오류를 모의 주입했을 때 진행 중 processor가 있는 경우에도 세 worker가 종료되고, 새 enqueue 함수는 호출되지 않았다. 종료 후 16초 동안 관측용 `INFO`를 제외한 추가 Redis 명령이 없었다. 실제 Upstash 한도 오류 재현이 아니라 오류 이벤트 주입 시험이다.
- 새 guard/worker 인스턴스에서 Redis에 남긴 대기 작업 3개를 처리했다. 실제 Nest 초기화에서 bootstrap 전 worker 미실행, 상속된 오류 핸들러 등록, 정상 처리와 한도 오류 종료도 확인했다. 운영 DB·실제 AI 호출을 포함한 복구 검증은 아니다.
- 최초 통합 실행의 복구 fixture는 worker의 로컬 pause만으로 대기 작업이 보존된다고 가정해 timeout이 발생했다. 진행 중 fetch가 작업을 가져갈 수 있어, 임시 테스트 큐만 전역 pause하고 실제 대기 개수를 검증하도록 수정했다. 이후 `npm run test:queue-safety -- --functional-only` 통과. 125초 전후 측정은 수정 전 실행에서 완료했으며, fixture 수정 후 동일 측정을 다시 반복하지는 않았다. 검증에 생성한 Redis/프로세스는 종료했다.
- **무료 월 50만 회 이내 사용을 보장하지 않는다.** 실제 작업량, 인스턴스 수, Lua 명령 과금 집계, 네트워크/오류 상황에 따라 달라진다. 이 변경은 불필요한 대기 호출과 한도 초과 후 반복 실패를 줄이지만, 이미 소진된 한도를 복구하지 않는다. [Upstash도 BullMQ가 작업 없이 Redis를 정기적으로 사용한다고 안내한다](https://upstash.com/docs/redis/integrations/bullmq).

### ERR-001 유휴 작업자 중지 및 DB 기반 재개 (2026-10-15)

#### 남아 있던 문제

10월 10일 변경은 유휴 Redis 호출을 줄였지만 완전히 멈추지는 않았다. 사용자가 앱을 사용하지 않아도 실행 중인 BullMQ worker의 fetch와 stalled 확인이 계속될 수 있었다. 이미 소진된 운영 한도도 복구되지 않았다.

#### 이번 해결 방법

- 세 worker는 bootstrap에서 등록만 하고, 해당 큐의 작업 등록이 성공했을 때 실행한다. bootstrap 전에 성공한 등록도 기억한다.
- 마지막 DB 작업 수요 이후 15초의 유예 시간이 지나고 로컬 실행 작업이 없으면 `worker.pause(false)`로 해당 worker만 멈춘다. 전역 큐를 pause하지 않으며, 이미 가져온 작업은 안전하게 마무리한다. 실행 중인 작업의 lock 갱신을 끊지 않는다.
- pause 도중 새 작업이 들어오면 pause 완료 후 다시 깨운다. 한도 차단이나 서버 종료가 발생하면 예약된 재개를 취소한다.
- 기본 요약·밀도별 요약의 기존 5초 DB dispatcher를 유지한다. DB에 처리할 작업이 없으면 Redis를 호출하지 않는다. 같은 job ID의 재등록도 수요 신호로 사용하므로, Redis에 이전 active 작업이 남아 있으면 stalled 복구가 계속 실행된다.
- 자동 분류도 5초 간격으로 DB에서 복구한다. 기존 인덱스로 PENDING/만료 RUNNING을 각각 최대 50개 조회하고, 별도로 PK cursor를 따라 글 메타데이터 50개씩 순회해 한도 오류 중 생성되지 못한 분류 레코드와 변경된 원문 세대를 찾는다. 전체 글 본문을 매번 조회하지 않으며 마지막 페이지 후 처음부터 순회한다. 정상 실패의 무한 재시도와 사용자가 편집한 분류의 덮어쓰기는 하지 않는다. 5분이 지난 실행 회수에는 revision·sourceGeneration·leaseToken 비교를 적용한다.
- BullMQ의 완료 후 다음 작업을 바로 가져오는 경로는 `active` 이벤트를 생략할 수 있어, 실제 processor 진입/종료를 공통 host에서 추적한다. Redis 완료/실패 이벤트가 없어도 `finally`에서 정리해 작업자가 계속 깨어 있는 누수를 방지한다. 이미 닫힌 worker에는 지연된 타이머가 다시 접근하지 않는다.
- 새 Redis로 이전하더라도 MySQL의 대기 작업이 다시 등록되는 구조를 유지한다. 완료된 글을 재요약하거나 요약 프롬프트를 바꾸지 않는다. 미분류 과거 글은 자동 분류 backlog에 포함될 수 있으며, 이는 실제 AI/Redis 사용량을 만든다.
- 새 패키지·DB migration·모바일 변경은 없다. DB 조회 비용, 연결 초기화/재연결 비용, 실제 작업 비용은 남는다. 월 50만 회 이하 사용을 보장하는 변경은 아니다.

#### 신규 Redis 생성 확인 및 운영 복구 경계

- 로그인된 Upstash 콘솔에서 기존 `readnest-redis`가 Free Tier, 월간 명령 약 50만, SUSPENDED로 표시되는 것을 확인했다. 목록 배너에는 bandwidth limit 문구도 있어, 기존 서버의 request-limit 오류와 동일한 집계 원인이라고 단정하지 않는다.
- `Create Database`를 열자 **무료 등급은 DB 1개이며 추가 DB 생성에는 결제수단 등록/요금제 변경이 필요하다**는 안내로 차단됐다. [공식 가격표](https://upstash.com/pricing/redis)의 1 Free DB 제한과 일치한다.
- 새 DB는 생성하지 않았다. 기존 DB 삭제, 결제수단 등록, 요금제 변경, 운영 환경변수 변경, 운영 배포도 수행하지 않았다. 삭제 후 재생성으로 무료 한도가 복구된다는 보장은 없으며 해결책으로 사용하지 않는다.
- 기존 DB의 한도 회복/요금제 변경을 선택하면 연결 주소 변경 없이 개선 코드를 배포하고 재시작한다. 별도 Redis 이전을 선택하면 연결 환경변수를 먼저 검증한 뒤 개선 코드를 배포·재시작한다. `REDIS_URL`이 있으면 개별 `REDIS_HOST/PORT/USERNAME/PASSWORD/TLS`보다 우선하므로 서로 다른 대상을 혼용하지 않는다. 비밀값은 문서나 대화에 붙이지 않는다.
- 이전할 때는 기존 worker를 중단하고 동일한 MySQL을 유지한 상태로 새 worker를 올린다. DB lease 회수 후 대기 작업이 처리되는지 확인한다. 새 Redis만 만들거나 서버만 재시작하는 것은 근본 해결이 아니다.

#### 검증

- `npm run build`: 통과. `npm test -- --runInBand`: **21 suites / 219 tests 통과**. 전체 ESLint는 오류 0건, 기존 `main.ts` floating promise 경고 1건이다. `git diff --check` 통과.
- 회귀 테스트는 bootstrap 이전 등록, 큐별 재개, pause 도중 등록/종료/한도 차단, 실행 중 작업, 완료 이벤트 없는 lost-lock 경로의 정리, 닫힌 worker의 늦은 콜백, DB 무작업 조회, 분류의 누락/만료/세대 변경/수동 편집/정상 실패/배치 정체 방지를 포함한다.
- 최종 코드에서 세 큐의 초기 유휴 125,020ms와 작업 후 절전 상태 125,008ms를 각각 측정했고, 관측용 `INFO`를 제외한 Redis 명령 증가가 모두 **0건**이었다. enqueue부터 processor 시작까지 로컬 무부하 측정은 20ms / 1ms / 1ms였다. 초기 handshake·절전 전 유예·실제 작업·재연결 비용과 Upstash 청구량은 이 수치에 포함하지 않는다.
- 실제 BullMQ에서 pause 도중 enqueue 재개, `active` 이벤트 없이 가져온 작업의 18초 이상 lock 유지 및 concurrency 2 활용, 한도 오류 모의 주입 후 16초 추가 명령 0건, 새 worker의 대기 작업 3건 처리, 실제 Nest bootstrap 전 등록과 상속된 오류 핸들러를 확인했다.
- stalled 회수 fixture는 테스트용 lock/stalled 간격을 줄여 실행했다. 추가 functional 실행에서는 기존 orphan lock을 18초 유지해 15초 유휴 유예를 넘겨도 DB 수요 갱신 신호로 깨어 있는 것을 확인했고, 18,227ms 후 1회 복구됐다. 운영의 120초 stalled 간격/90초 DB lease를 실제 시간대로 함께 검증한 결과는 아니다.
- 전체 통합 실행과 보완 functional 실행 모두 종료 코드 0으로 완료했다. 테스트용 Redis·Node 프로세스와 소켓은 정리했으며 운영 연결정보나 `.env`는 사용하지 않았다.
- 실제 MySQL·운영 Redis·실제 AI를 포함한 이전은 실행하지 않았다. DB 복구 조건은 mock 기반 단위 테스트, Redis 재개는 격리 Redis 통합 테스트로 각각 검증했다. 공급자별 TLS/재연결/명령 호환성은 대상 선택 후 확인한다. **운영 상태는 미해결**이며 운영 한도 복구 및 배포 후 검증 전에는 해결로 변경하지 않는다.

#### 다른 서비스 이전 검토 — 사용자 선택 반영 (2026-10-15)

사용자는 기존 Upstash 유료 전환 대신 다른 Redis 서비스 검토를 선택했다. 아래는 공식 문서 기반 후보 비교이며 계정 생성·결제·운영 변경은 하지 않았다.

| 후보 | 확인한 조건 | 판단 |
| --- | --- | --- |
| Redis Cloud Essentials 유료 | [공식 가격표](https://redis.io/pricing/)상 월 $5부터. [일반 250MB 플랜](https://redis.io/docs/latest/operate/rc/subscriptions/view-essentials-subscription/essentials-plan-details/)은 256 연결·1,000 ops/s·월 100GB 네트워크 제한. 유료 플랜은 [AOF persistence](https://redis.io/docs/latest/operate/rc/databases/configuration/data-persistence/)를 지원하고 [미사용만을 이유로 삭제하지 않음](https://support.redislabs.com/hc/en-us/articles/34131767970450-Preventing-Database-Deletion-Due-to-Inactivity-in-Redis-Cloud). | 운영 우선 후보. 실제 지역·플랜·복제 옵션의 견적은 생성 직전 확인. $5 기본 가격을 고가용성 보장이나 무제한 사용으로 해석하지 않는다. |
| Redis Cloud 무료 | 30MB·30 연결·100 ops/s·월 5GB. persistence/복제 없음. [14일 미사용 시 삭제될 수 있음](https://support.redislabs.com/hc/en-us/articles/33138489404818-Free-Redis-Cloud-Database-Deleted-Due-to-Inactivity). | 테스트용 후보. 절전 worker와 함께 장기간 미사용할 운영 서비스의 상시 가용성을 보장하지 못한다. |
| Aiven Valkey 무료 | [1GB RAM, maxmemory 50%, 단일 노드, SLA 없음, 미사용 시 전원 중지 가능](https://aiven.io/docs/products/valkey/concepts/valkey-free-tier). 무료는 [지역 선택 불가](https://aiven.io/docs/products/valkey/get-started). | 무료 실험 후보. 실제 BullMQ/TLS 검증 필요. 현재 앱은 `rediss://`일 때 TLS를 활성화하므로 공급자의 `valkeys://` URI를 그대로 쓰지 않고 지원하는 TLS 연결 형식으로 구성해야 한다. |
| Render Key Value 무료 | [외부 TLS 연결·IP 허용 목록·noeviction 선택 지원](https://render.com/docs/key-value). [무료는 재시작 시 데이터 소실](https://render.com/docs/free). | 테스트용 후보. KoDeploy 송신 IP/연결 가능 여부 확인 필요. 운영은 persistence 지원 유료 플랜을 별도 검토. |

공통 이전 조건: 메모리 정책 `noeviction`, TLS 검증 유지, 필요한 송신 IP만 허용, 세 큐의 Lua/blocking 명령 확인, 동일 MySQL 유지, 기존 worker 종료 후 새 연결로 기동, 대기 작업 및 오류 재시도 검증. 새 서비스에도 메모리·처리량·연결·네트워크 제한은 존재한다. 무료 서비스 유지를 위해 의미 없는 주기 요청을 추가하는 방식으로 이번 절전 개선을 되돌리지 않는다.

### ERR-001 무료 플랜 운영 재평가·재배포 준비 (2026-10-15)

사용자가 기존 Upstash 무료를 유지하고 수정된 코드로 KoDeploy 재배포 및 실제 테스트를 요청했다.

#### 배포 전 새로 확인한 오류

- 운영 `/api/health`는 HTTP 200, DB 정상이나 queue 상태 필드가 없어 최신 개선 코드가 아직 운영에 반영되지 않은 것을 확인했다. KoDeploy 최신 성공 배포는 여전히 #6(10월 9일)이었다.
- Upstash `readnest-redis`는 Free Tier, 월 대역폭 **10GB / 10GB**, 요청 배너 **497,396 / 500,000**, 저장 **7KB**, 비용 **$0.00**로 표시됐다. 콘솔은 **monthly bandwidth limit로 SUSPENDED**라고 명시했다. 이전의 요청 한도 오류와 별도로 현재 대역폭 한도에 의해 중지된 상태가 확인됐다.
- 운영 연결 단계에서 아래 오류가 반복됐다. 문구에 Fixed plan이 있어도 콘솔의 실제 요금제는 무료이므로 유료 전환됐다고 해석하지 않는다.

```text
ERR This database has reached current Fixed plan limits.
Please upgrade manually or enable auto upgrade on Upstash Console
command: auth (인증 인자는 기록하지 않음)
```

- 기존 guard는 `max requests limit exceeded`만 감지해 이 오류를 차단하지 못했다. worker 종료만으로는 producer Queue의 AUTH 재연결도 멈추지 않는다. 기존 라이브러리 오류 로그에 인증 인자가 포함될 수 있는 것을 확인했고 새 로그에는 오류 원문·인자를 출력하지 않는다.

#### 해결 진행

- 위 공급자 한도 오류를 명확히 구분해 차단하고 producer Queue 연결도 닫도록 보완했다. ready 연결의 종료가 거절되면 공개 `disconnect()`로 강제 종료한다. 일반 인증 실패·네트워크 장애·AI rate limit은 이 한도 차단 조건으로 취급하지 않는다.
- 격리된 TCP 서버에서 실제 Nest/BullMQ의 AUTH 거부를 재현하자 BullMQ 5.78.1의 초기화 오류 Promise가 연결 종료 후 제거된 오류 리스너로 전달되어 unhandled rejection이 발생했다. 전역 Promise 오류를 무시하지 않고, 정확한 버전을 고정한 설치 호환 패치로 이미 닫힌 RedisConnection의 late-init 오류 전달만 생략한다. `scripts/apply-bullmq-close-patch.cjs`는 CJS/ESM 원문을 검증하고 설치 시 재현 가능하게 적용하며, 버전 변경 시 검토 없이 설치가 진행되지 않게 한다.
- 보완 코드 검증 후 기존 무료 연결을 유지해 main으로 배포한다. 현재 한도가 복구되지 않으면 성공 요약 및 정상 유휴 사용량 평가는 완료할 수 없으므로, 실제 차단 동작과 HTTP/DB 상태 검증을 성공 요약 테스트와 구분해 기록한다.
- 보완 후 build·자동 테스트 **21 suites / 225 tests** 통과, ESLint 오류 0건/기존 경고 1건이다. 격리 TCP/Nest 테스트에서 producer 먼저/worker 먼저 AUTH 한도 거부 두 순서를 검증했다. 각 9개 초기 AUTH 연결 이후 큐 3개와 worker 3개가 종료되고 3초간 재연결 0회, 늦은 등록 종료, 추가 enqueue 차단, unhandled rejection 0건을 확인했다. 일반 WRONGPASS 오류는 live 리스너에 전달되며 영구 한도 차단을 일으키지 않았다.
- 별도 임시 디렉터리에서 `.env` 없이 `npm ci` 및 Dockerfile과 같은 `npm prune --omit=dev`를 실행해 설치 패치의 재현성과 반복 적용을 확인했다. 기존 패키지의 로컬 Node 20 엔진 경고는 남아 있고 운영 Dockerfile은 Node 22를 사용한다. DB 연결·migration·AI 호출 없이 설치만 검증했다.
- 기존 functional 통합 시나리오도 종료 코드 0으로 통과했다. 짧은 유휴 관측에서 명령 0회, 재개 6/1/1ms, pause 경쟁 조건·prefetch 잠금 갱신/동시성 2 유지·18,392ms orphan 회수·한도 차단 후 16,002ms 명령 0회·대기 작업 3개 복구·Nest 초기화를 검증했다. 이번 보완 후 125초 관측을 반복한 결과는 아니며, 기존 긴 관측 기록과 구분한다. 격리 Redis/TCP 프로세스는 모두 정리했다.
- 상태: **배포 준비 / 무료 한도 미복구**. 유료 전환·기존 DB 삭제·신규 DB 생성은 하지 않았다.

## 새 오류 기록 양식

```markdown
## ERR-NNN — 오류 제목
- 기록일:
- 상태: 미해결
- 환경 / 영향 / 우선순위:

### 오류
증상과 민감정보를 제거한 핵심 로그

### 확인된 사실

### 추정 원인 — 미확정

### 조사 및 해결 후보 — 아직 미적용

### 해결 방법
아직 해결되지 않음.
- 해결일:
- 실제 적용 방법:
- 관련 커밋 / PR / 배포 / migration:
- 검증 결과:
- 재발 방지:
```
