# ReadNest 진행상황 기록

## 2026-07-14 백엔드 배포 시작 실패 대응

### 문제

배포 로그상 Docker 이미지 빌드와 push는 완료되었지만, 배포된 Pod가 제한 시간 안에 정상 시작되지 않는 문제가 있었습니다.

빌드는 성공했으므로 NestJS 컴파일 문제가 아니라 실행 단계 문제로 판단했습니다.

주요 후보:

- API가 `0.0.0.0`으로 바인딩되지 않음
- 배포 환경변수 누락
- 시작 명령어가 `npm run start`로 되어 있어 빌드 결과 대신 개발 실행 경로를 탈 가능성
- 배포 환경 Node 버전이 18이라 NestJS 11, `@google/genai` 요구사항과 맞지 않음

### 변경 내용

수정 파일:

- `readnest-api/src/main.ts`
- `readnest-api/package.json`
- `README.md`

추가 파일:

- `readnest-api/nixpacks.toml`

`main.ts` 변경:

```ts
const port = Number(process.env.PORT) || 3000;
await app.listen(port, "0.0.0.0");
console.log(`ReadNest API listening on port ${port}`);
```

`package.json`에는 Node 20 이상을 명시했습니다.

```json
{
  "engines": {
    "node": ">=20.11.0"
  }
}
```

Nixpacks 설정:

```toml
[phases.setup]
nixPkgs = ["nodejs_20", "npm-10_x", "openssl"]

[phases.build]
cmds = ["npm ci", "npm run build"]

[start]
cmd = "npm run start:prod"
```

### 배포 설정 기준

배포 플랫폼에는 다음 기준을 사용합니다.

```text
Root Directory: readnest-api
Build Command: npm ci && npm run build
Start Command: npm run start:prod
Node: >=20.11.0
```

필수 환경변수:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `REDIS_HOST`
- `REDIS_PORT`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `DAILY_SAVE_LIMIT`
- `SUMMARY_RETRY_LIMIT`
- `PLAYWRIGHT_CHANNEL`
- `PLAYWRIGHT_PAGE_TIMEOUT_MS`
- `PLAYWRIGHT_SCROLL_COUNT`
- `EXTRACT_TEXT_LIMIT`

### 검증 결과

아래 명령을 실행했습니다.

```bash
cd readnest-api
npm run build
npm test -- --runInBand
node -v
```

결과:

```text
Nest build 성공
Jest 테스트 1개 통과
Node v20.19.5
```

### 2026-07-14 KoDeploy 설정 재점검

KoDeploy가 자동 감지한 설정은 Node 18, `npm run start`였으므로 런타임 실패 가능성이 남아 있었습니다.

실제 파일 확인 결과:

- `nest-cli.json`의 `sourceRoot`는 `src`
- `tsconfig.json`의 `outDir`는 `./dist`
- 실제 빌드 출력 파일은 `dist/main.js`
- 기존 `start:prod`는 `node dist/main`이었으나 명확하게 `node dist/main.js`로 변경
- KoDeploy 자동 시작 명령어가 `npm run start`여도 운영 빌드 결과를 실행하도록 `start`도 `node dist/main.js`로 변경

추가 변경:

- 런타임 환경변수 검증 추가
- `DATABASE_URL`이 없을 때 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`로 MySQL URL 생성
- `JWT_SECRET` 누락 시 명확한 오류 로그 후 시작 중단
- `GEMINI_API_KEY` 누락 시 fallback 요약 사용 경고 출력
- Prisma DB 연결 실패 시 `DATABASE_URL` 또는 KoDeploy DB 환경변수 확인 메시지 출력
- Node 22 기반 멀티 스테이지 `readnest-api/Dockerfile` 추가
- `readnest-api/.dockerignore` 추가
- Nixpacks Node 버전을 Node 22로 변경

KoDeploy 권장 입력값:

```text
Repository: SmileCheetah/ReadNest
Branch: main
App Directory: readnest-api
Port: 3000
Dockerfile Path: readnest-api/Dockerfile
Build Command: npm ci && npm run build
Start Command: npm run start
```

확인할 런타임 로그:

```text
ReadNest API listening on port 3000
Connected to database
```

검증 결과:

```bash
cd readnest-api
npm run prisma:generate
npm run build
npm test -- --runInBand
PORT=4030 npm run start
```

결과:

```text
Prisma Client 생성 성공
Nest build 성공
Jest 테스트 1개 통과
GET /api/health 정상 응답
```

환경변수 누락 테스트:

```text
[env] ReadNest API cannot start.
[env] Missing or invalid environment variables: DATABASE_URL or DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET
[env] Configure KoDeploy environment variables before redeploying.
```

로컬 Docker build는 Docker CLI는 설치되어 있으나 Docker daemon이 꺼져 있어 실행하지 못했습니다.

```text
Cannot connect to the Docker daemon
```

### 2026-07-14 KoDeploy Nixpacks build cache 충돌 수정

KoDeploy 빌드 로그에서 실제 실패 지점은 런타임이 아니라 Nixpacks build phase였습니다.

실패 로그:

```text
npm error EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'
```

원인:

- Nixpacks install phase에서 이미 `npm ci`를 실행했습니다.
- `nixpacks.toml` build phase에도 `npm ci`를 다시 넣어둔 상태였습니다.
- 두 번째 `npm ci`가 `node_modules`를 정리하는 과정에서 BuildKit cache mount인 `/app/node_modules/.cache`를 삭제하려다 `EBUSY`로 실패했습니다.

수정:

```toml
[phases.build]
cmds = ["npm run build"]
```

Prisma Client 생성은 `package.json`의 `postinstall`에서 `prisma generate`를 실행하므로 install phase에서 처리됩니다.

KoDeploy build command 문서도 `npm run build`로 변경했습니다.

### 2026-07-14 환경변수 보강

배포 플랫폼에서 Redis를 `REDIS_URL` 하나로 제공하는 경우를 고려해 Redis 설정을 확장했습니다.

추가/정리한 환경변수:

- `NODE_ENV`
- `REDIS_URL`
- `REDIS_USERNAME`
- `REDIS_PASSWORD`
- `REDIS_TLS`

`REDIS_URL`이 설정되어 있으면 이를 우선 사용합니다. `rediss://` URL은 TLS Redis로 처리합니다.

수정 파일:

- `readnest-api/src/app.module.ts`
- `readnest-api/.env.example`
- `readnest-api/.env.local-mysql.example`
- `readnest-api/.env.docker.example`
- `readnest-api/README.md`
- `README.md`

## 2026-07-14 GitHub 업로드 준비

### 작업 목적

ReadNest 프로젝트를 GitHub에 올리기 전에 민감 파일과 생성물이 커밋되지 않도록 루트 `.gitignore`를 추가했습니다.

### 변경 내용

추가 파일:

- `.gitignore`

제외 대상:

- `.env`, `.env.local`, `.env.*.local`
- `node_modules`
- `dist`
- `coverage`
- `.expo`
- macOS `.DS_Store`
- npm/yarn/pnpm debug log
- 에디터 설정 폴더

### 확인 결과

`readnest-api/.env`, `node_modules`, `dist` 등이 git ignore 대상임을 확인했습니다.

확인 과정에서 `git init`도 실행되어 `ReadNest` 폴더가 로컬 git 저장소로 초기화되었습니다.

### 2026-07-14 추가 진행

GitHub 업로드를 위해 전체 프로젝트를 첫 커밋으로 묶었습니다.

커밋:

```text
Initial ReadNest MVP
```

실제 `.env`, `node_modules`, `dist`가 staged 파일에 포함되지 않는 것을 확인했습니다.

현재 로컬 커밋은 준비되었지만, `gh` CLI가 설치되어 있지 않아 GitHub repo 자동 생성과 push는 아직 진행하지 못했습니다.

확인 결과 `https://github.com/SmileCheetah/ReadNest.git` 원격 저장소는 아직 존재하지 않는 상태였습니다.

### 2026-07-14 GitHub push 완료

GitHub에서 `SmileCheetah/ReadNest` 저장소가 생성된 뒤 로컬 `origin`을 연결하고 `main` 브랜치를 push했습니다.

원격 저장소:

```text
https://github.com/SmileCheetah/ReadNest
```

push된 최초 커밋:

```text
b7efdad Initial ReadNest MVP
```

확인 결과:

```text
main -> origin/main
```

## 2026-07-14 모바일 API 주소 환경변수 분리

### 작업 목적

실제 기기에서 Expo Go 또는 개발 빌드로 앱을 실행할 때 `localhost`가 개발 PC가 아니라 기기 자신을 가리키는 문제가 있습니다.

이를 해결하기 위해 모바일 앱의 API 주소를 코드 수정 없이 환경변수로 바꿀 수 있게 정리했습니다.

### 변경 내용

기존:

```ts
export const API_BASE_URL = "http://localhost:3000/api";
```

변경:

```ts
const DEFAULT_API_BASE_URL = "http://localhost:3000/api";

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, "");
```

수정 파일:

- `readnest-mobile/src/api/readnestApi.ts`
- `readnest-mobile/.gitignore`
- `readnest-mobile/README.md`

추가 파일:

- `readnest-mobile/.env.example`

### 사용 방법

기본값은 기존과 같은 로컬 주소입니다.

```text
http://localhost:3000/api
```

실제 기기에서 테스트할 때는 `readnest-mobile/.env.local`을 만들고 Mac의 LAN IP를 넣습니다.

```bash
cd /Users/m3air/Desktop/Code/Node/ReadNest/readnest-mobile
cp .env.example .env.local
```

예시:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.4:3000/api
```

환경변수를 바꾼 뒤에는 Metro 캐시를 비우고 다시 실행합니다.

```bash
npm run start -- --clear
```

### 검증 결과

아래 명령을 실행했습니다.

```bash
cd readnest-mobile
npm run typecheck
```

결과:

```text
tsc --noEmit 통과
```

백엔드도 변경 영향이 없는지 확인했습니다.

```bash
cd readnest-api
npm run build
npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 1개 통과
```

### 다음 작업

1. 실제 기기 또는 시뮬레이터에서 앱 로그인/저장 흐름을 확인합니다.
2. 실제 Threads URL로 원문 추출과 요약 품질을 확인합니다.
3. 요약 상태 UX를 더 명확하게 정리합니다.

## 2026-07-14 README 실행 문서 정리

### 작업 목적

프로젝트 루트 README가 소개와 문서 링크 중심이라, 다음 작업자가 바로 실행할 수 있는 정보가 부족했습니다.

로컬 실행, 환경변수, 검증 명령을 루트 README에 정리했습니다.

### 변경 내용

수정 파일:

- `README.md`

추가한 내용:

- 현재 구현 상태
- 백엔드 로컬 실행 순서
- Homebrew MySQL/Redis 실행 방법
- Docker Compose 실행 방법
- Prisma Client 생성과 migration 실행 방법
- API health check 주소
- 모바일 앱 실행 방법
- 실제 기기용 `EXPO_PUBLIC_API_BASE_URL` 설정 예시
- API 환경변수 목록
- 모바일 환경변수 목록
- API/Mobile 검증 명령

### 확인 결과

`readnest-api/.env.example`과 `readnest-api/.env.local-mysql.example`에는 현재 코드에서 사용하는 주요 환경변수가 포함되어 있었습니다.

포함된 주요 변수:

- `DATABASE_URL`
- `PORT`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `REDIS_HOST`
- `REDIS_PORT`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `DAILY_SAVE_LIMIT`
- `SUMMARY_RETRY_LIMIT`
- `PLAYWRIGHT_CHANNEL`
- `PLAYWRIGHT_PAGE_TIMEOUT_MS`
- `PLAYWRIGHT_SCROLL_COUNT`
- `EXTRACT_TEXT_LIMIT`

모바일에는 `readnest-mobile/.env.example`을 추가해 `EXPO_PUBLIC_API_BASE_URL` 기준을 문서화했습니다.

## 2026-07-14 아카이브 검색/필터 API 연결

### 작업 목적

기존 모바일 아카이브는 전체 저장글을 불러온 뒤 앱 안에서만 검색, 기간, 읽음 상태 필터를 적용했습니다.

저장글이 늘어나면 불필요한 데이터를 많이 가져오게 되므로, 백엔드의 `GET /api/articles` query와 모바일 아카이브 필터를 연결했습니다.

### 변경 내용

수정 파일:

- `readnest-mobile/src/api/readnestApi.ts`
- `readnest-mobile/App.tsx`

API 클라이언트 변경:

- `listArticles(token, period)` 형태를 `listArticles(token, options)` 형태로 변경했습니다.
- 지원 옵션:
  - `period`
  - `readStatus`
  - `processStatus`
  - `search`
  - `limit`

모바일 앱 변경:

- 홈 목록용 `threads`와 아카이브 목록용 `archiveThreads`를 분리했습니다.
- 아카이브 화면에 들어가거나 필터가 바뀌면 서버에서 다시 조회합니다.
- 검색어 입력은 짧은 지연 후 서버 query로 전달합니다.
- 한국어 탭을 API period 값으로 매핑했습니다.
  - `오늘` -> `today`
  - `이번 주` -> `week`
  - `지난주` -> `last-week`
  - `이번 달` -> `month`
  - `월별 아카이브` -> `all`
- 읽음 필터는 `ALL`일 때 query에서 제외하고, 나머지는 `readStatus`로 전달합니다.
- 상세 조회, 읽음 상태 변경, 요약 재시도, 삭제 시 홈 목록과 아카이브 목록을 함께 갱신합니다.

### 검증 결과

아래 명령을 실행했습니다.

```bash
cd readnest-mobile
npm run typecheck
```

결과:

```text
tsc --noEmit 통과
```

백엔드도 변경 영향이 없는지 확인했습니다.

```bash
cd readnest-api
npm run build
npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 1개 통과
```

### 남은 확인

- 실제 앱 화면에서 검색어 입력 시 서버 결과가 자연스럽게 갱신되는지 확인해야 합니다.
- 태그 전용 필터는 아직 없습니다.
- 월별 아카이브는 현재 `period=all` 조회이며, 월 단위 그룹 UI는 추후 개선 대상입니다.

## 2026-07-14 로컬 통합 실행 확인

### 확인 목적

문서상 구현된 MVP 흐름이 실제 로컬 환경에서 동작하는지 확인했습니다.

확인 범위:

1. 로컬 MySQL / Redis 실행 상태
2. Prisma migration 상태
3. NestJS API 빌드와 테스트
4. API 서버 실행
5. 인증, 저장글 생성, 요약 큐 처리, 읽음 상태 변경, 삭제 API
6. Expo Metro dev server 실행

### 로컬 인프라 상태

Docker CLI는 설치되어 있지만 Docker daemon은 실행 중이 아니었습니다.

```text
Cannot connect to the Docker daemon
```

대신 Homebrew 서비스로 MySQL과 Redis가 실행 중인 것을 확인했습니다.

- MySQL: `127.0.0.1:3306`
- Redis: `127.0.0.1:6379`

Redis 연결 확인:

```text
PONG
```

### Prisma / DB

`readnest-api`에서 Prisma Client 생성을 확인했습니다.

```bash
npm run prisma:generate
```

결과:

```text
Generated Prisma Client 성공
```

Migration 상태 확인:

```bash
npx prisma migrate status
```

결과:

```text
Database schema is up to date
```

현재 DB는 `.env` 기준 `localhost:3306`의 `readnest` 데이터베이스를 사용합니다.

### 백엔드 검증

아래 명령을 실행했습니다.

```bash
npm run build
npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 1개 통과
```

API 서버 실행:

```bash
npm run start:dev
```

서버가 정상 기동되었고 `/api` prefix 아래 주요 라우트가 매핑되었습니다.

Health check:

```text
GET /api/health
```

응답:

```json
{
  "status": "ok",
  "service": "readnest-api",
  "scope": "threads-mvp"
}
```

### API 통합 흐름 확인

테스트 계정을 생성해 실제 API 흐름을 확인했습니다.

확인한 흐름:

- 회원가입 성공
- JWT access token 발급 확인
- 저장글 생성 성공
- 저장 직후 `processStatus`가 `SUMMARIZING`으로 생성됨
- BullMQ worker가 작업 처리
- 저장글 상태가 `SUMMARY_DONE`으로 변경됨
- 원문 추출 상태가 `FALLBACK_SUCCESS`로 저장됨
- 요약 결과 저장 확인
- 읽음 상태를 `READ`로 변경 성공
- 저장글 삭제 성공

요약 처리 확인 결과:

```text
status=SUMMARY_DONE
extraction=FALLBACK_SUCCESS
summary_present=yes
```

테스트 URL은 `https://example.com`을 사용했습니다. Threads 실제 URL 추출 품질은 별도 QA가 필요합니다.

### 모바일 검증

`readnest-mobile`에서 타입 체크를 실행했습니다.

```bash
npm run typecheck
```

결과:

```text
tsc --noEmit 통과
```

Expo Metro dev server 실행:

```bash
npm run start -- --clear
```

결과:

```text
Metro waiting on exp://192.168.0.4:8081
Web is waiting on http://localhost:8081
```

Metro dev server는 정상 기동했습니다.

### 확인된 이슈 / 남은 확인

- Docker daemon은 꺼져 있었지만 Homebrew MySQL/Redis로 통합 확인은 가능했습니다.
- 실제 Threads URL 저장과 Playwright 추출 품질은 아직 확인하지 않았습니다.
- 모바일 앱에서 버튼을 눌러 가입, 저장, 요약 확인까지 하는 실제 기기 QA는 아직 남아 있습니다.
- 모바일 API 주소가 `http://localhost:3000/api`로 고정되어 있어 실제 기기에서는 개발 PC IP 또는 환경변수 설정이 필요할 수 있습니다.
- 자동 테스트는 아직 1개뿐이라 인증/저장글/요약 큐 테스트 보강이 필요합니다.

### 다음 작업

1. 모바일 API 주소를 환경변수로 분리합니다.
2. 실제 기기 또는 시뮬레이터에서 앱 흐름을 직접 확인합니다.
3. 실제 Threads URL로 원문 추출과 요약 품질을 점검합니다.
4. 요약 상태 UX를 더 명확하게 다듬습니다.

## 2026-06-14

### 방향 결정

- ReadNest는 우선 Threads 기준으로만 작업하기로 결정했습니다.
- 데이터베이스는 MySQL을 사용하기로 결정했습니다.
- 프론트는 React Native 앱으로 먼저 구현하기로 결정했습니다.
- 디자인 방향은 Notion 스타일의 차분한 문서형 UI로 잡았습니다.

### 문서화 완료

- `docs/PROJECT_BRIEF.md`
  - 원본 기획서를 보관했습니다.
- `docs/WORKING_NOTES.md`
  - MySQL 기준 데이터 모델, API 초안, 상태값, 개발 원칙을 정리했습니다.
- `docs/MVP_PLAN.md`
  - MVP 구현 단계를 정리했습니다.

### React Native 프론트 생성

경로:

```text
ReadNest/readnest-mobile
```

Expo 기반 React Native 프로젝트를 구성했습니다.

생성된 주요 파일:

- `readnest-mobile/App.tsx`
- `readnest-mobile/package.json`
- `readnest-mobile/app.json`
- `readnest-mobile/tsconfig.json`
- `readnest-mobile/README.md`
- `readnest-mobile/.gitignore`
- `readnest-mobile/src/theme/tokens.ts`
- `readnest-mobile/src/data/mockThreads.ts`
- `readnest-mobile/src/components/AppHeader.tsx`
- `readnest-mobile/src/components/BottomNav.tsx`
- `readnest-mobile/src/components/StatusBadge.tsx`
- `readnest-mobile/src/components/ThreadCard.tsx`

### 구현된 화면

#### 홈

- ReadNest 헤더
- Threads URL 입력 영역
- `Save Thread` 버튼
- 오늘 저장글 목록
- 요약 중 목록
- 안 읽음 목록

#### 아카이브

- 검색 입력
- 기간 탭
  - 오늘
  - 이번 주
  - 지난주
  - 이번 달
  - 월별 아카이브
- 날짜별 Thread 카드 목록

#### 상세

- 저장된 Thread 제목
- Threads 출처
- 저장일
- 태그
- 읽음 표시 버튼
- 원본 링크 보기 버튼
- AI 요약
- 주요 포인트
- 연속 Thread 감지 상태
- 맥락 부족 안내

#### 설정

- 계정 정보
- 요약 언어
- 저장 대상 `Threads only`
- 로그아웃 버튼

### 디자인 적용 내용

- Notion 스타일의 따뜻한 off-white 배경을 사용했습니다.
- 흰색 카드와 연한 회색 hairline border를 사용했습니다.
- 구조적 강조색은 파란색 하나로 제한했습니다.
- 카드와 버튼은 8px에서 12px 사이의 절제된 radius를 사용했습니다.
- 상태는 pill 형태의 작은 배지로 표시했습니다.
- SNS 피드처럼 자극적인 화면보다 저장된 지식을 읽기 쉽게 보는 화면에 집중했습니다.

### 현재 데이터 상태

백엔드 API 연결 전이므로 `src/data/mockThreads.ts`의 목데이터를 사용합니다.

목데이터에는 다음 상태를 포함했습니다.

- 요약 중
- 요약 완료
- 맥락 부족
- 안 읽음
- 읽음
- 나중에 다시 보기
- 연속 Thread 일부 감지

### 검증 결과

의존성 설치:

```bash
npm install
```

타입 체크:

```bash
npm run typecheck
```

결과:

```text
tsc --noEmit 통과
```

## 2026-06-14 Summary Queue 구현

### 구현 범위

저장글 생성 후 비동기 요약 작업을 처리하기 위한 BullMQ 기반 summary queue를 추가했습니다.

아직 실제 AI API 호출은 붙이지 않았고, worker는 임시 요약 데이터를 생성합니다.

구현된 흐름:

1. `POST /api/articles`로 URL 저장
2. article이 `SUMMARIZING` 상태로 생성됨
3. BullMQ `summary` queue에 작업 등록
4. worker가 작업 처리
5. article의 `summary`, `keyPoints`, `tags` 저장
6. `processStatus`를 `SUMMARY_DONE`으로 변경
7. 실패 시 `SUMMARY_FAILED`로 변경

### 추가 의존성

- `@nestjs/bullmq`
- `bullmq`

### 추가된 파일

- `readnest-api/src/summary/summary.module.ts`
- `readnest-api/src/summary/summary.service.ts`
- `readnest-api/src/summary/summary.processor.ts`
- `readnest-api/src/summary/summary.controller.ts`
- `readnest-api/src/summary/summary.constants.ts`

### 수정된 파일

- `readnest-api/src/articles/articles.service.ts`
- `readnest-api/src/articles/articles.module.ts`
- `readnest-api/src/app.module.ts`
- `readnest-api/docker-compose.yml`
- `readnest-api/.env.example`
- `readnest-api/.env.local-mysql.example`
- `readnest-api/.env.docker.example`
- `readnest-api/.env`

### 추가된 API

- `GET /api/articles/:articleId/summary/status`
- `POST /api/articles/:articleId/summary`
- `POST /api/articles/:articleId/summary/retry`

### Redis

Redis가 summary queue 처리에 필요합니다.

`docker-compose.yml`에 Redis 7.4 서비스를 추가했습니다.

```yaml
redis:
  image: redis:7.4
  ports:
    - "6379:6379"
```

환경 변수:

```env
REDIS_HOST="localhost"
REDIS_PORT=6379
```

현재 로컬 환경에서는 Redis가 아직 실행 중이지 않아 worker 실동작 검증은 보류했습니다.

Redis 실행 후보:

```bash
brew install redis
brew services start redis
```

또는 Docker Desktop 실행 후:

```bash
docker compose up -d redis
```

### 검증 결과

아래 명령을 실행했습니다.

```bash
npm run build
npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 1개 통과
```

### 실행 참고

실행 명령:

```bash
cd /Users/m3air/Desktop/Code/Node/ReadNest/readnest-mobile
npm run start
```

Expo 실행 중 다음 오류가 발생했습니다.

```text
EMFILE: too many open files, watch
```

이는 코드 문제가 아니라 macOS에서 Metro watcher가 많은 파일을 감시하다가 발생한 오류입니다.

해결 방법:

```bash
brew install watchman
npm run start
```

### 2026-06-14 실행 오류 해결 기록

#### 오류

iOS 번들 후 다음 오류가 발생했습니다.

```text
TypeError: _ExpoFontLoader.default.getLoadedFonts is not a function
```

오류 위치는 `AppHeader` 내부의 `Icon`으로 표시되었습니다.

#### 원인

`@expo/vector-icons`가 사용하는 `expo-font` 버전이 Expo SDK 51과 맞지 않게 설치되어 발생한 문제였습니다.

확인 당시 `@expo/vector-icons` 내부에 최신 계열 `expo-font@56.0.6`이 들어가 있었고, 프로젝트의 Expo SDK 51은 `expo-font@12.0.10`을 사용해야 했습니다.

#### 처리

Expo SDK 51과 호환되는 버전으로 의존성을 다시 정렬했습니다.

```bash
cd /Users/m3air/Desktop/Code/Node/ReadNest/readnest-mobile
npx expo install @expo/vector-icons expo-font
```

변경 결과:

- `expo-font`를 명시 의존성으로 추가했습니다.
- `app.json`에 `expo-font` 플러그인이 추가되었습니다.
- `@expo/vector-icons`가 `expo-font@12.0.10`을 사용하도록 정리되었습니다.

검증:

```bash
npm run typecheck
```

결과:

```text
tsc --noEmit 통과
```

다시 실행할 때는 Metro 캐시를 비우는 것을 권장합니다.

```bash
npm run start -- --clear
```

### 다음 작업 후보

1. Watchman 설치 후 Expo 실행 확인
2. 앱 화면을 실제 기기 또는 시뮬레이터에서 확인
3. 홈 화면 URL 저장 UX 다듬기
4. React Navigation 도입 여부 결정
5. 백엔드 NestJS 프로젝트 생성
6. MySQL, Prisma 연결
7. 인증 API 구현
8. 저장글 API 구현 후 앱 목데이터를 API 호출로 교체
9. Threads 공유 저장 기능 조사

## 2026-06-14 백엔드 1단계

### NestJS API 생성

경로:

```text
ReadNest/readnest-api
```

NestJS 백엔드 프로젝트를 생성했습니다.

현재 백엔드 기본 스택:

- NestJS 11
- TypeScript
- Prisma 6.19.3
- MySQL
- `@nestjs/config`
- `class-validator`
- `class-transformer`

Prisma는 처음 설치 시 7.x가 들어왔지만 현재 Node 20 환경에서 경고가 있어 `6.19.3`으로 고정했습니다.

### 추가된 백엔드 파일

- `readnest-api/.env.example`
- `readnest-api/.gitignore`
- `readnest-api/docker-compose.yml`
- `readnest-api/prisma/schema.prisma`
- `readnest-api/src/prisma/prisma.module.ts`
- `readnest-api/src/prisma/prisma.service.ts`
- `readnest-api/README.md`

### Prisma / MySQL 모델 초안

`prisma/schema.prisma`에 Threads MVP 기준 모델을 작성했습니다.

- `User`
- `SavedArticle`
- `ThreadGroup`
- `ThreadPart`

상태 enum:

- `ArticleSource`
- `ProcessStatus`
- `ReadStatus`
- `ThreadGroupStatus`

주요 제약:

- 사용자별 URL 중복 저장 방지: `userId`, `normalizedUrl` 복합 유니크
- 목록 조회용 인덱스: `userId`, `savedAt`
- 상태 필터용 인덱스: `userId`, `processStatus`, `userId`, `readStatus`
- 연속 Thread 파트 중복 방지: `threadGroupId`, `partNumber` 복합 유니크

### NestJS 기본 구조 변경

- `ConfigModule`을 전역 모듈로 추가했습니다.
- `PrismaModule`과 `PrismaService`를 추가했습니다.
- 전역 API prefix를 `/api`로 설정했습니다.
- 전역 `ValidationPipe`를 설정했습니다.
- 기본 루트 응답 대신 Health Check를 추가했습니다.

Health Check:

```text
GET /api/health
```

응답 예:

```json
{
  "status": "ok",
  "service": "readnest-api",
  "scope": "threads-mvp",
  "timestamp": "..."
}
```

### 로컬 MySQL

`docker-compose.yml`로 MySQL 8.4 로컬 개발 DB를 추가했습니다.

Homebrew MySQL이 `localhost:3306`을 이미 사용 중인 환경을 고려해 Docker MySQL은 호스트 `3307` 포트로 노출하도록 변경했습니다.

실행:

```bash
cd /Users/m3air/Desktop/Code/Node/ReadNest/readnest-api
cp .env.docker.example .env
docker compose up -d
npm run prisma:migrate -- --name init
```

Homebrew MySQL을 그대로 사용할 경우:

```bash
cp .env.local-mysql.example .env
```

이후 `readnest` DB와 `readnest_user` 계정을 만들어야 합니다. 자세한 내용은 `readnest-api/docs/mysql-setup.md`에 기록했습니다.

로컬 MySQL의 비밀번호 정책 때문에 기존 예시 비밀번호 `readnest_password`가 거절되었습니다. 예시 비밀번호를 `ReadNest2026!`로 변경했습니다.

Prisma Migrate는 개발 환경에서 shadow database를 만들기 때문에 `readnest_user`에 `CREATE`, `DROP`, `ALTER`, `REFERENCES` 전역 권한이 추가로 필요합니다. 관련 내용은 `readnest-api/docs/mysql-setup.md`에 기록했습니다.

### 검증 결과

아래 명령을 실행했습니다.

```bash
npm run prisma:generate
npm run build
npm test -- --runInBand
```

결과:

```text
Prisma Client 생성 성공
Nest build 성공
Jest 테스트 1개 통과
```

### 다음 작업 후보

1. Docker MySQL 실행 후 첫 Prisma migration 생성
2. Auth 모듈 구현
3. 회원가입 DTO / 로그인 DTO 작성
4. 비밀번호 해시 처리
5. JWT 발급과 Guard 구성
6. `GET /api/auth/me` 구현

## 2026-06-14 인증 API 구현

### 구현 범위

NestJS 백엔드에 JWT 기반 인증 흐름을 추가했습니다.

구현된 API:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`

### 추가 의존성

- `@nestjs/jwt`
- `@nestjs/passport`
- `passport`
- `passport-jwt`
- `bcryptjs`
- `@types/passport-jwt`

### 추가된 파일

- `readnest-api/src/auth/auth.module.ts`
- `readnest-api/src/auth/auth.controller.ts`
- `readnest-api/src/auth/auth.service.ts`
- `readnest-api/src/auth/jwt.strategy.ts`
- `readnest-api/src/auth/jwt-auth.guard.ts`
- `readnest-api/src/auth/current-user.decorator.ts`
- `readnest-api/src/auth/dto/signup.dto.ts`
- `readnest-api/src/auth/dto/login.dto.ts`
- `readnest-api/src/auth/types/auth-user.ts`
- `readnest-api/src/auth/types/auth-response.ts`

### 동작 방식

- 회원가입 시 이메일은 소문자로 저장합니다.
- 비밀번호는 `bcryptjs`로 해시한 뒤 `passwordHash`에 저장합니다.
- 로그인 시 이메일과 비밀번호를 검증합니다.
- 인증 성공 시 JWT access token과 사용자 정보를 반환합니다.
- `GET /api/auth/me`는 `Authorization: Bearer <accessToken>` 헤더가 필요합니다.
- 응답에는 `passwordHash`를 포함하지 않습니다.

### 환경 변수

`.env.example`, `.env.local-mysql.example`, `.env.docker.example`에 JWT 설정을 추가했습니다.

```env
JWT_SECRET="change-me-readnest-dev-secret"
JWT_EXPIRES_IN="7d"
```

### 검증 결과

아래 명령을 실행했습니다.

```bash
npm run build
npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 1개 통과
```

### 다음 작업 후보

1. 실제 DB 연결 상태에서 회원가입/로그인 curl 테스트
2. 저장글 Articles 모듈 구현
3. URL 정규화 유틸 작성
4. 사용자별 중복 URL 저장 방지 구현
5. 저장글 목록/상세 조회 구현

## 2026-06-14 저장글 Articles API 구현

### 구현 범위

Threads MVP의 저장글 기본 API를 추가했습니다.

구현된 API:

- `POST /api/articles`
- `GET /api/articles`
- `GET /api/articles/check-duplicate`
- `GET /api/articles/:id`
- `PATCH /api/articles/:id/read-status`
- `DELETE /api/articles/:id`

모든 Articles API는 JWT 인증이 필요합니다.

```http
Authorization: Bearer <accessToken>
```

### 추가된 파일

- `readnest-api/src/articles/articles.module.ts`
- `readnest-api/src/articles/articles.controller.ts`
- `readnest-api/src/articles/articles.service.ts`
- `readnest-api/src/articles/dto/create-article.dto.ts`
- `readnest-api/src/articles/dto/list-articles-query.dto.ts`
- `readnest-api/src/articles/dto/check-duplicate-query.dto.ts`
- `readnest-api/src/articles/dto/update-read-status.dto.ts`
- `readnest-api/src/articles/utils/normalize-url.ts`

### 동작 방식

- URL 저장 시 `normalizedUrl`을 생성합니다.
- 사용자별 `userId`, `normalizedUrl` 복합 유니크 제약으로 중복 저장을 막습니다.
- 중복 저장 시 `409 Conflict`와 기존 article 정보를 반환합니다.
- 모든 조회, 수정, 삭제는 로그인 사용자 `userId` 기준으로 소유권을 확인합니다.
- 목록 조회는 `period`, `processStatus`, `readStatus`, `search`, `limit` query를 지원합니다.
- 읽음 상태는 `UNREAD`, `READ`, `READ_LATER`로 변경할 수 있습니다.

### URL 정규화

초기 정규화는 다음만 처리합니다.

- host 소문자 처리
- hash 제거
- 기본 포트 제거
- 대표 tracking query 제거
- query 정렬
- 끝 슬래시 제거

### 검증 결과

아래 명령을 실행했습니다.

```bash
npm run build
npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 1개 통과
```

### 다음 작업 후보

1. 실제 DB 연결 상태에서 Auth + Articles curl 흐름 테스트
2. React Native 앱에서 로그인 화면 추가
3. 앱 목데이터를 Articles API 호출로 교체
4. 요약 큐 BullMQ 모듈 추가
5. URL 저장 시 요약 작업 등록

## 2026-06-14 Auth + Articles 실제 DB 흐름 검증

### 검증 환경

- API 서버: `http://localhost:3000`
- DB: Homebrew MySQL `localhost:3306`
- Prisma migration 상태: 최신

확인 명령:

```bash
npx prisma migrate status
```

결과:

```text
Database schema is up to date
```

### 검증한 API 흐름

아래 순서로 실제 API 요청을 확인했습니다.

1. `POST /api/auth/signup`
2. `GET /api/auth/me`
3. `POST /api/articles`
4. `GET /api/articles`
5. `GET /api/articles/check-duplicate`
6. `PATCH /api/articles/:id/read-status`

### 확인 결과

- 회원가입 시 JWT access token이 발급됩니다.
- 발급된 token으로 `GET /api/auth/me` 호출이 가능합니다.
- URL 저장이 정상 동작합니다.
- `utm_source`와 hash가 제거된 `normalizedUrl`이 저장됩니다.
- 같은 URL 중복 확인이 정상 동작합니다.
- 읽음 상태를 `READ_LATER`로 변경할 수 있습니다.

### 발견한 문제와 수정

초기 검증 중 `POST /api/auth/signup` 응답의 `user` 객체에 `passwordHash`가 포함되는 문제가 있었습니다.

원인:

- TypeScript 타입에서는 `passwordHash`를 제외했지만, Prisma에서 받은 런타임 user 객체를 그대로 응답에 넣고 있었습니다.

수정:

- `AuthService.createAuthResponse()`에서 안전한 사용자 필드만 새 객체로 만들어 반환하도록 변경했습니다.

검증 결과:

```json
{
  "userKeys": ["id", "email", "nickname", "createdAt", "updatedAt"],
  "hasPasswordHash": false
}
```

### 추가 검증

아래 명령을 다시 실행했습니다.

```bash
npm run build
npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 1개 통과
```

## 2026-06-14 모바일 앱 API 연결

### 구현 범위

React Native 앱에 실제 ReadNest API 연결을 추가했습니다.

추가된 흐름:

- 로그인
- 회원가입
- JWT access token 메모리 보관
- 로그인 후 저장글 목록 조회
- Threads URL 저장
- 저장글 상세 보기
- 원본 링크 열기
- 읽음 / 안 읽음 상태 변경
- 로그아웃

### 추가된 파일

- `readnest-mobile/src/api/readnestApi.ts`
- `readnest-mobile/src/api/articleMapper.ts`

### 수정된 파일

- `readnest-mobile/App.tsx`
- `readnest-mobile/src/data/mockThreads.ts`
- `readnest-mobile/src/components/StatusBadge.tsx`
- `readnest-mobile/README.md`

### API 주소

모바일 앱 기본 API 주소:

```text
http://localhost:3000/api
```

위 값은 `readnest-mobile/src/api/readnestApi.ts`의 `API_BASE_URL`에서 관리합니다.

iOS 시뮬레이터에서는 `localhost`로 Mac의 API 서버에 접근할 수 있습니다. 실제 기기 Expo Go에서 테스트할 경우 Mac의 LAN IP로 변경해야 합니다.

예:

```ts
export const API_BASE_URL = "http://192.168.0.4:3000/api";
```

### 구현 메모

- `expo-secure-store`를 도입해 access token을 보관합니다.
- 백엔드 요약 큐가 연결되어 저장 직후 article은 `SUMMARIZING` 상태로 표시됩니다.
- 요약이 없는 글은 임시 안내 문구와 기본 주요 포인트를 보여줍니다.

### 검증 결과

아래 명령을 실행했습니다.

```bash
npm run typecheck
```

결과:

```text
tsc --noEmit 통과
```

## 2026-06-14 Redis / AI / Thread 감지 / QA 마무리

### Redis 실동작 검증

Homebrew Redis를 설치하고 실행했습니다.

```bash
brew install redis
brew services start redis
redis-cli ping
```

결과:

```text
PONG
```

API 서버 실행 후 저장글 생성과 worker 처리를 실제로 검증했습니다.

결과:

```json
{
  "created": {
    "processStatus": "SUMMARIZING"
  },
  "afterWorker": {
    "processStatus": "SUMMARY_DONE",
    "hasSummary": true
  }
}
```

### AI 요약 연동

Gemini SDK를 추가했습니다.

추가 의존성:

- `@google/genai`

추가된 파일:

- `readnest-api/src/summary/ai-summary.service.ts`
- `readnest-api/src/summary/content-extractor.service.ts`

환경 변수:

```env
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
```

동작 방식:

- `GEMINI_API_KEY`가 있으면 Gemini API로 구조화된 JSON 요약을 생성합니다.
- 키가 없거나 호출 실패 시 fallback 요약을 생성합니다.
- 요약 결과는 `title`, `summary`, `keyPoints`, `tags`, `contextInsufficient` 형태입니다.

Gemini 공식 문서 기준:

- Gemini API는 `application/json` 응답과 응답 스키마를 지원합니다.
- 구조화 출력 지원 모델에 Gemini 2.5 Flash 계열이 포함됩니다.

참고:

- https://ai.google.dev/gemini-api/docs/structured-output
- https://googleapis.github.io/js-genai/

### 원문 / Threads 내용 추출 방식 결정

MVP에서는 Threads 공식 API나 브라우저 자동화를 사용하지 않습니다.

현재 방식:

- URL fetch
- `og:title`, `og:description`, `description`, `<title>` 추출
- HTML 태그 제거 후 본문 텍스트 추출
- 충분한 텍스트가 없으면 `CONTEXT_INSUFFICIENT`

결정 이유:

- Threads 페이지는 동적 렌더링과 접근 제한 가능성이 있습니다.
- MVP에서는 저장 흐름과 요약 큐를 안정화하는 것이 우선입니다.
- 추후 공유 payload나 별도 extractor를 개선합니다.

### AI fallback 검증

Gemini API key가 없는 상태에서 fallback 요약 경로를 실제 worker로 검증했습니다.

결과:

```json
{
  "created": {
    "processStatus": "SUMMARIZING"
  },
  "detail": {
    "processStatus": "SUMMARY_DONE",
    "hasSummary": true,
    "keyPoints": [
      "원문 추출 완료",
      "요약 큐 처리 완료",
      "AI 요약 연동 가능 상태"
    ],
    "tags": ["Threads", "ReadNest", "요약대기"]
  }
}
```

### 연속 Thread 감지

`1/3`, `2/3`, `part 1 of 3` 같은 패턴을 감지해 `ThreadGroup`, `ThreadPart`에 연결하도록 구현했습니다.

추가된 파일:

- `readnest-api/src/summary/thread-detection.service.ts`

검증 결과:

```json
{
  "processStatus": "CONTEXT_INSUFFICIENT",
  "threadParts": [
    {
      "partNumber": 1,
      "totalParts": 3,
      "groupStatus": "PARTIAL"
    }
  ]
}
```

### 모바일 로그인 유지 / 요약 새로고침

추가 의존성:

- `expo-secure-store`
- `expo-linking`

구현 내용:

- 로그인 성공 시 access token을 SecureStore에 저장합니다.
- 앱 재시작 시 token으로 `GET /api/auth/me`를 호출해 세션을 복구합니다.
- 로그아웃 시 token을 삭제합니다.
- URL 저장 후 2.5초 뒤 목록을 자동 새로고침해 `SUMMARIZING`에서 완료 상태로 바뀐 결과를 반영합니다.
- 목록 item을 누르면 `GET /api/articles/:id`로 상세를 다시 조회해 연속 Thread 정보를 가져옵니다.

### Deep Link 기반 공유 저장

MVP에서 가능한 최소 공유 저장 입구를 추가했습니다.

지원 딥링크:

```text
readnest://save?url=https%3A%2F%2Fwww.threads.net%2F...
```

동작:

- 앱이 딥링크를 감지합니다.
- `url` query를 URL 입력칸에 채웁니다.
- 사용자가 `Save Thread`를 눌러 저장합니다.

OS 공유 시트 직접 수신은 Expo Go에서 완전 검증하기 어렵습니다. Expo 공식 문서 기준으로 공유 intent payload를 처리하려면 개발 빌드/EAS 단계에서 추가 네이티브 구성이 필요합니다.

참고:

- https://docs.expo.dev/versions/latest/sdk/sharing/
- https://docs.expo.dev/linking/android-app-links/

### 앱 QA

Browser Use용 Node REPL 도구가 현재 세션에 노출되지 않아 in-app browser 시각 검증은 수행하지 못했습니다.

대신 Expo Web export와 TypeScript 검증을 수행했습니다.

```bash
npx expo export --platform web
npm run typecheck
```

결과:

```text
Expo Web export 성공
tsc --noEmit 통과
```

`dist`가 TypeScript 검사에 포함되지 않도록 `readnest-mobile/tsconfig.json`에 `exclude`를 추가했습니다.

### 연속 Thread 자동 본문 추출 개선

Threads 페이지를 일반 HTTP fetch로 가져올 경우, 원문 아래로 이어지는 답글 Thread 본문이 HTML 응답에 포함되지 않는 사례를 확인했습니다.

예시:

```text
https://www.threads.com/@specwave_official/post/DZjm_c7mnlK?hl=ko
```

해결 방식:

- `playwright`를 추가해 Threads 링크는 실제 브라우저 렌더링 후 본문을 추출합니다.
- 링크 하나만 저장해도 원문 아래로 이어지는 작성자 답글까지 요약 재료로 사용합니다.
- 일반 fetch 추출은 브라우저 추출 실패 시 fallback으로 유지합니다.
- 같은 URL을 다시 저장하면 중복 에러 대신 기존 저장글을 재요약 큐에 넣습니다.
- 모바일 홈 저장 패널의 수동 전체 본문 입력칸은 제거했습니다.

수정 파일:

- `readnest-api/src/articles/dto/create-article.dto.ts`
- `readnest-api/src/articles/articles.service.ts`
- `readnest-api/src/summary/content-extractor.service.ts`
- `readnest-api/src/summary/summary.processor.ts`
- `readnest-mobile/App.tsx`
- `readnest-mobile/src/api/readnestApi.ts`

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
cd readnest-mobile && npm run typecheck
```

결과:

```text
Nest build 성공
Jest 테스트 통과
React Native TypeScript 검사 통과
```

### KoDeploy DB 환경변수 자동 조합 보강

KoDeploy MySQL 의존성이 `DATABASE_URL` 대신 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`를 제공하는 상황에 맞춰 Prisma 연결 흐름을 보강했습니다.

구현 내용:

- 앱 시작 시 `DATABASE_URL`이 있으면 그대로 우선 사용합니다.
- `DATABASE_URL`이 없으면 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` 5개 값을 조합해 `DATABASE_URL`을 생성합니다.
- 둘 다 없으면 시작 시 명확한 오류를 출력합니다.
- production에서 생성된 DB URL이 localhost를 가리키면 시작을 중단합니다.
- Prisma CLI용 wrapper `scripts/with-database-url.cjs`를 추가했습니다.
- `postinstall`, `prisma:generate`, `prisma:migrate`, `prisma:studio`가 wrapper를 통해 실행되도록 변경했습니다.
- Dockerfile도 wrapper 스크립트를 복사하고 `npm run prisma:generate`를 사용하도록 수정했습니다.
- KoDeploy 환경변수 안내를 README에 반영했습니다.

수정 파일:

- `readnest-api/src/config/runtime-env.ts`
- `readnest-api/scripts/with-database-url.cjs`
- `readnest-api/package.json`
- `readnest-api/Dockerfile`
- `readnest-api/.env.production.example`
- `README.md`
- `readnest-api/README.md`
- `docs/PROGRESS_LOG.md`

검증:

```bash
cd readnest-api && READNEST_SKIP_DOTENV=true env -u DATABASE_URL DB_HOST=db.example.com DB_PORT=3306 DB_NAME=readnest DB_USER=readnest_user DB_PASSWORD='secret-pass' node scripts/with-database-url.cjs prisma generate
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
```

결과:

```text
DB_*만으로 DATABASE_URL 생성 확인
Prisma generate 성공
Nest build 성공
Jest 테스트 통과
```

### KoDeploy DATABASE_URL 형식 호환 보강

KoDeploy 문서에서 MySQL 의존성 사용 시 `DATABASE_URL`이 `mysql+pymysql://...` 형식으로 함께 주입될 수 있음을 확인했습니다. 이 값은 Python용 접속 문자열에 가깝고 Prisma MySQL datasource는 `mysql://...` 형식을 기대하므로, 런타임과 Prisma CLI wrapper를 보강했습니다.

수정 내용:

- `DATABASE_URL=mysql://...`이면 그대로 사용합니다.
- `DATABASE_URL=mysql+pymysql://...`이면 `mysql://...`로 정규화합니다.
- `DATABASE_URL`이 Prisma와 맞지 않는 다른 형식이고 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`가 있으면 DB 변수 조합값으로 다시 생성합니다.
- 정규화 또는 재생성 시 `[env]` 경고 로그를 출력합니다.
- Prisma CLI wrapper에도 같은 정규화 로직을 적용했습니다.

수정 파일:

- `readnest-api/src/config/runtime-env.ts`
- `readnest-api/scripts/with-database-url.cjs`

검증:

```bash
cd readnest-api && READNEST_SKIP_DOTENV=true DATABASE_URL='mysql+pymysql://app:pass@mysql:3306/app' node scripts/with-database-url.cjs node -e "console.log(process.env.DATABASE_URL)"
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
cd readnest-api && READNEST_SKIP_DOTENV=true NODE_ENV=production PORT=3000 DATABASE_URL='mysql+pymysql://app:pass@mysql:3306/app' JWT_SECRET='12345678901234567890123456789012' REDIS_URL='rediss://default:pass@redis.example.com:6379' GEMINI_API_KEY='test-key' node -e "require('./dist/config/runtime-env').validateRuntimeEnv(); console.log(process.env.DATABASE_URL)"
```

결과:

```text
mysql+pymysql:// URL이 mysql:// URL로 정규화됨
Nest build 성공
Jest 테스트 통과
런타임 환경 검증 통과
```

### KoDeploy 런타임 NODE_ENV 누락 대응

KoDeploy 런타임 로그에서 `NODE_ENV`가 누락되어 앱이 시작 전에 중단되는 문제를 확인했습니다.

로그:

```text
[env] ReadNest API cannot start.
[env] Missing or invalid environment variables: NODE_ENV
```

원인:

- Nixpacks 빌드 단계에는 `NODE_ENV=production`이 표시되지만, 컨테이너 런타임에는 `NODE_ENV`가 전달되지 않을 수 있습니다.
- 기존 `start:prod`가 `node dist/main.js`만 실행해서 앱 내부 환경 검증 전에 기본값을 보장하지 못했습니다.

수정 내용:

- `scripts/start-prod.cjs`를 추가했습니다.
- `start`, `start:prod`가 `node scripts/start-prod.cjs`를 실행하도록 변경했습니다.
- wrapper는 `NODE_ENV`가 없을 때만 `production`으로 설정한 뒤 `dist/main.js`를 로드합니다.

수정 파일:

- `readnest-api/package.json`
- `readnest-api/scripts/start-prod.cjs`

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
cd readnest-api && env -u NODE_ENV PORT=4310 DATABASE_URL='mysql+pymysql://app:pass@mysql:3306/app' JWT_SECRET='12345678901234567890123456789012' REDIS_URL='rediss://default:pass@redis.example.com:6379' GEMINI_API_KEY='test-key' npm run start:prod
```

결과:

```text
Nest build 성공
Jest 테스트 통과
NODE_ENV 없이 start:prod 실행 시 production으로 기본 설정 확인
ReadNest API listening on port 4310 확인
```

### NODE_ENV 값 정규화 보강

KoDeploy 런타임에서 여전히 예전 이미지가 실행되거나, 환경변수 UI에 `NODE_ENV` 값이 따옴표 포함으로 저장될 수 있는 상황을 고려해 런타임 환경 검증을 한 번 더 보강했습니다.

확인한 로그:

```text
[env] Missing or invalid environment variables: NODE_ENV must be development, test, or production
```

수정 내용:

- `NODE_ENV`가 없으면 앱 내부에서 `production`으로 기본 설정합니다.
- `NODE_ENV`가 `"production"` 또는 `'production'`처럼 따옴표를 포함해도 `production`으로 정규화합니다.
- 정규화 시 `[env]` 경고 로그를 출력합니다.

수정 파일:

- `readnest-api/src/config/runtime-env.ts`

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
cd readnest-api && READNEST_SKIP_DOTENV=true env -u NODE_ENV PORT=3000 DATABASE_URL='mysql+pymysql://app:pass@mysql:3306/app' JWT_SECRET='12345678901234567890123456789012' REDIS_URL='rediss://default:pass@redis.example.com:6379' GEMINI_API_KEY='test-key' node -e "require('./dist/config/runtime-env').validateRuntimeEnv(); console.log(process.env.NODE_ENV, process.env.DATABASE_URL)"
cd readnest-api && READNEST_SKIP_DOTENV=true NODE_ENV='"production"' PORT=3000 DATABASE_URL='mysql+pymysql://app:pass@mysql:3306/app' JWT_SECRET='12345678901234567890123456789012' REDIS_URL='rediss://default:pass@redis.example.com:6379' GEMINI_API_KEY='test-key' node -e "require('./dist/config/runtime-env').validateRuntimeEnv(); console.log(process.env.NODE_ENV, process.env.DATABASE_URL)"
```

결과:

```text
Nest build 성공
Jest 테스트 통과
NODE_ENV 누락 시 production 기본 설정 확인
NODE_ENV 따옴표 포함 값 정규화 확인
```

### KoDeploy Pod 시작 타임아웃 2차 대응

KoDeploy 빌드는 성공하지만 컨테이너 실행 후 Pod 시작 타임아웃이 발생하는 문제를 추가 점검했습니다.

확인 내용:

- Nixpacks 빌드 로그상 `npm ci`, `npm run build`, 이미지 export/push는 성공했습니다.
- 런타임에서 포트가 열리기 전 실패하는 원인 후보를 확인했습니다.
- `PrismaService.onModuleInit()`이 앱 부팅 중 `$connect()`를 강제하고, DB 연결 실패 시 예외를 던지는 구조였습니다.
- 이 구조에서는 DB 환경변수 오류, DB 준비 지연, 네트워크 지연이 있으면 `app.listen()`까지 도달하지 못할 수 있습니다.

수정 내용:

- Prisma DB 연결을 Nest 부팅 필수 조건에서 제거했습니다.
- `/api/health`에서 DB 연결 상태를 확인하도록 변경했습니다.
- DB 연결 실패 시 서버를 종료하지 않고 `database.status: "error"`와 오류 메시지를 응답에 포함합니다.
- 헬스 체크 테스트를 비동기 응답 구조에 맞게 수정했습니다.

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
cd readnest-api && NODE_ENV=production PORT=4300 DATABASE_URL='mysql://bad:bad@127.0.0.1:65535/readnest' JWT_SECRET='local-prod-test-secret' REDIS_HOST='127.0.0.1' REDIS_PORT='65534' GEMINI_API_KEY='' npm run start:prod
curl -sS http://127.0.0.1:4300/api/health
```

결과:

```text
Nest build 성공
Jest 테스트 통과
잘못된 DB 주소에서도 ReadNest API listening on port 4300 출력 확인
/api/health 응답 확인
```

헬스 체크 예시:

```json
{
  "status": "ok",
  "service": "readnest-api",
  "scope": "threads-mvp",
  "database": {
    "status": "error",
    "message": "Can't reach database server ..."
  }
}
```

남은 배포 확인 항목:

- KoDeploy에 `DATABASE_URL` 또는 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` 등록
- KoDeploy에 `JWT_SECRET` 등록
- 요약 기능을 사용할 경우 `GEMINI_API_KEY` 등록
- BullMQ 요약 큐를 사용할 경우 `REDIS_URL` 또는 Redis 개별 환경변수 등록

### 운영 환경 기준 로컬 의존 제거 점검

배포/출시 기준으로 아직 로컬 환경에 기대는 코드가 남아 있는지 점검하고, 운영 모드에서 잘못된 기본값을 차단하도록 수정했습니다.

확인한 위험 지점:

- 모바일 API 주소가 없으면 `http://localhost:3000/api`로 fallback했습니다.
- Redis 환경변수가 없으면 백엔드 BullMQ가 `localhost:6379`로 fallback했습니다.
- JWT 설정 내부에 개발용 secret fallback 문자열이 남아 있었습니다.
- 운영 환경에서도 `GEMINI_API_KEY` 없이 fallback 요약으로 진행될 수 있었습니다.

수정 내용:

- `NODE_ENV=production`에서는 `DATABASE_URL`이 localhost를 가리키면 시작을 중단합니다.
- `NODE_ENV=production`에서는 `REDIS_URL` 또는 `REDIS_HOST`를 필수로 요구합니다.
- `NODE_ENV=production`에서는 Redis가 localhost를 가리키면 시작을 중단합니다.
- `NODE_ENV=production`에서는 `GEMINI_API_KEY`를 필수로 요구합니다.
- `NODE_ENV=production`에서는 개발용/짧은 `JWT_SECRET`을 거부합니다.
- JWT 모듈과 JWT 전략에서 개발용 secret fallback을 제거하고 `JWT_SECRET`을 필수로 읽게 했습니다.
- 모바일 릴리즈 빌드에서는 `EXPO_PUBLIC_API_BASE_URL`이 없으면 즉시 오류가 나도록 변경했습니다.
- 로컬용 `.env.example`과 운영용 `.env.production.example`을 분리했습니다.

추가/수정 파일:

- `readnest-api/src/config/runtime-env.ts`
- `readnest-api/src/app.module.ts`
- `readnest-api/src/auth/auth.module.ts`
- `readnest-api/src/auth/jwt.strategy.ts`
- `readnest-api/.env.example`
- `readnest-api/.env.production.example`
- `readnest-mobile/src/api/readnestApi.ts`
- `readnest-mobile/.env.example`
- `readnest-mobile/.env.production.example`

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
cd readnest-mobile && npm run typecheck
cd readnest-api && NODE_ENV=production PORT=3000 DATABASE_URL='mysql://user:pass@db.example.com:3306/readnest' JWT_SECRET='12345678901234567890123456789012' REDIS_URL='rediss://default:pass@redis.example.com:6379' GEMINI_API_KEY='test-key' node -e "require('./dist/config/runtime-env').validateRuntimeEnv(); console.log('production env ok')"
cd readnest-api && NODE_ENV=production PORT=3000 DATABASE_URL='mysql://user:pass@localhost:3306/readnest' JWT_SECRET='change-me-readnest-dev-secret' node -e "try { require('./dist/config/runtime-env').validateRuntimeEnv(); } catch (error) { process.exit(42); }"; test $? -eq 42 && echo 'production invalid env rejected'
```

결과:

```text
Nest build 성공
Jest 테스트 통과
React Native TypeScript 검사 통과
정상 production env 통과
localhost DB, 개발용 JWT, Redis/Gemini 누락 production env 거부 확인
```

### 요약본 삭제 기능

백엔드에 이미 구현된 `DELETE /api/articles/:id`를 모바일 상세 화면에 연결했습니다.

동작:

- 저장글 상세 화면에서 `삭제` 버튼을 누릅니다.
- 확인 Alert에서 `삭제`를 선택하면 저장글과 AI 요약이 함께 삭제됩니다.
- 삭제 성공 시 상세 화면을 닫고 목록에서도 해당 항목을 제거합니다.

수정 파일:

- `readnest-mobile/src/api/readnestApi.ts`
- `readnest-mobile/App.tsx`

검증:

```bash
cd readnest-mobile && npm run typecheck
```

결과:

```text
React Native TypeScript 검사 통과
```

### 번호형 Thread 요약 개선

연속 Thread가 `1/9`, `2/9`, `1.`, `2.`처럼 번호별 주장 구조를 갖는 경우, 첫 원문만 중심으로 요약되지 않도록 Gemini 요약 프롬프트를 개선했습니다.

변경 내용:

- 번호가 있는 Thread 시리즈는 번호 순서의 논리 흐름을 보존하도록 지시했습니다.
- `keyPoints`를 최대 12개까지 허용해 `1.`, `2.`, `3.` 주장 단위로 표시할 수 있게 했습니다.
- Gemini fallback 경로에서도 `1.`, `2.` 패턴을 추출해 번호별 keyPoints를 만들도록 했습니다.
- 이미 저장된 중복 URL이라도 링크를 다시 저장하면 기존 저장글을 재요약 큐에 넣도록 했습니다.

수정 파일:

- `readnest-api/src/summary/ai-summary.service.ts`
- `readnest-api/src/articles/articles.service.ts`

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 통과
```

### 구현 예정 항목 추가

요약 상세 화면에서 사용할 후속 기능을 예정 목록에 추가했습니다. 이번 단계에서는 구현하지 않고 문서에만 기록했습니다.

예정 기능:

- 요약된 내용 바로 복사
- 요약된 내용 공유하기
- 공유 텍스트 포맷은 `제목`, `AI 요약`, `주요 포인트`, `원본 링크` 조합으로 검토

수정 파일:

- `docs/WORKING_NOTES.md`
- `docs/MVP_PLAN.md`

### ReadNest AI 요약 프롬프트 반영

사용자가 정의한 ReadNest 전용 AI 요약 프롬프트를 Gemini 요약 엔진에 반영했습니다.

반영 내용:

- 요약 엔진 역할을 “짧게 줄이기”가 아니라 “나중에 다시 읽기 좋게 의미 구조화”로 명시했습니다.
- 요약 유형을 `정보 정리형`, `주장 분석형`, `학습 자료형`, `아이디어 저장형`, `행동 추천형`, `기타` 중 하나로 분류하도록 했습니다.
- 출력 항목을 `요약 유형`, `제목`, `한 줄 요약`, `핵심 요약`, `주요 포인트`, `태그`, `읽을 가치`, `주의점`, `맥락 상태`, `연속 글 상태`, `요약 신뢰도` 기준으로 생성하도록 했습니다.
- 현재 DB/UI 구조에 맞춰 `주요 포인트`는 기존 `keyPoints`에 저장하고, 나머지 상세 항목은 `summary` 문자열 안에 구조화해 저장합니다.
- Gemini API key가 없을 때 사용하는 fallback 요약도 같은 섹션 구조를 따르도록 정리했습니다.

수정 파일:

- `readnest-api/src/summary/ai-summary.service.ts`

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
```

결과:

```text
Nest build 성공
Jest 테스트 통과
```

### 향후 개발 계획과 배포 기준 문서화

첨부된 ReadNest 향후 개발 계획을 별도 로드맵 문서로 정리했습니다.

추가된 문서:

- `docs/ROADMAP_AND_RELEASE_CRITERIA.md`

포함 내용:

- 현재 상태 요약
- 최우선 안정화 작업
- 요약 UX와 재시도 계획
- Threads 추출 실패 케이스
- 요약 결과 구조 개선
- 검색/필터 계획
- OS 공유 저장
- 백엔드 안정화
- 보안, 비용, 운영 기준
- 1차 배포, 소규모 공개 배포, 포트폴리오 완성 기준
- 우선순위 로드맵

`docs/WORKING_NOTES.md`에서도 해당 문서를 확인하도록 링크를 추가했습니다.

### `오늘 읽을 글` 예정 기능 추가

ReadNest의 핵심 문제인 “저장만 해두고 다시 읽지 않는 문제”를 줄이기 위한 홈 화면 기능을 예정 목록에 추가했습니다. 이번 단계에서는 구현하지 않고 문서에만 기록했습니다.

기능 방향:

- 홈 화면 상단에 `오늘 읽을 글` 섹션 추가
- 요약 완료 + 안 읽음 상태인 글 중 최근 저장순 3개 추천
- 나중에 다시 보기 상태는 추후 우선순위로 반영
- 전체 안 읽은 글 수를 압박하듯 보여주지 않고 부담 적은 문구 사용
- 향후 홈 전용 API에서 오늘 읽을 글, 요약 중인 글, 오늘 저장한 글, 안 읽은 글 수, 이번 주 저장 수를 함께 반환하는 방향 검토

수정 파일:

- `docs/ROADMAP_AND_RELEASE_CRITERIA.md`
- `docs/WORKING_NOTES.md`

### 핵심 UX 1차 구현

로드맵의 미구현 항목 중 코드 변경만으로 바로 닫을 수 있는 핵심 UX를 1차로 구현했습니다.

구현 내용:

- 홈 화면 상단에 `오늘 읽을 글` 섹션을 추가했습니다.
- `요약 완료 + 안 읽음/나중에 다시 보기` 글 중 최대 3개를 추천합니다.
- 요약 중인 글에는 “요약이 끝나면 오늘 읽을 글에 추가돼요” 안내를 표시합니다.
- 홈 전용 API `GET /api/articles/home`을 추가했습니다.
- 상세 화면에 `나중에 보기`, `요약 복사`, `공유`, `요약 재시도` 액션을 추가했습니다.
- 요약 복사는 `expo-clipboard`를 사용합니다.
- 요약 공유는 React Native `Share` API를 사용합니다.
- 아카이브 화면에 검색 입력과 읽음 상태 필터를 추가했습니다.

수정 파일:

- `readnest-api/src/articles/articles.controller.ts`
- `readnest-api/src/articles/articles.service.ts`
- `readnest-mobile/App.tsx`
- `readnest-mobile/src/api/readnestApi.ts`
- `readnest-mobile/package.json`
- `readnest-mobile/package-lock.json`

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
cd readnest-mobile && npm run typecheck
```

결과:

```text
Nest build 성공
Jest 테스트 통과
React Native TypeScript 검사 통과
```

남은 큰 범위:

- OS 공유 시트에서 ReadNest로 직접 저장
- 요약 결과 JSON/Summary 모델 분리
- 실제 기기 QA
- Playwright 운영 안정화
- API 사용량 제한
- 서버/모바일 배포 구성

### 백엔드 안정화 1차 구현

배포 전 안정화 항목 중 일부를 1차 구현했습니다.

구현 내용:

- `SavedArticle.summaryMeta` JSON 필드를 추가해 구조화 요약 결과를 저장합니다.
- `extractionStatus`, `extractionConfidence`를 추가해 원문 추출 상태와 신뢰도를 저장합니다.
- `summaryRetryCount`, `lastSummaryError`를 추가해 재시도 횟수와 마지막 실패 원인을 저장합니다.
- 수동 요약 재시도 횟수를 `SUMMARY_RETRY_LIMIT`으로 제한합니다.
- 하루 저장 개수를 `DAILY_SAVE_LIMIT`으로 제한합니다.
- Playwright 추출 설정을 환경변수로 분리했습니다.
- 로컬 DB에 `20260615000000_summary_metadata` 마이그레이션을 적용했습니다.
- 모바일 상세 화면에 요약 유형, 맥락 상태, 신뢰도를 표시합니다.
- e2e 테스트가 열린 핸들 때문에 멈추지 않도록 설정을 보강했습니다.

추가/수정 파일:

- `readnest-api/prisma/schema.prisma`
- `readnest-api/prisma/migrations/20260615000000_summary_metadata/migration.sql`
- `readnest-api/src/summary/ai-summary.service.ts`
- `readnest-api/src/summary/content-extractor.service.ts`
- `readnest-api/src/summary/summary.processor.ts`
- `readnest-api/src/summary/summary.service.ts`
- `readnest-api/src/articles/articles.service.ts`
- `readnest-api/test/jest-e2e.json`
- `readnest-mobile/src/api/readnestApi.ts`
- `readnest-mobile/src/api/articleMapper.ts`
- `readnest-mobile/src/data/mockThreads.ts`
- `readnest-mobile/App.tsx`

검증:

```bash
cd readnest-api && npm run build
cd readnest-api && npm test -- --runInBand
cd readnest-api && npm run test:e2e
cd readnest-mobile && npm run typecheck
```

결과:

```text
Nest build 성공
Jest 테스트 통과
e2e 테스트 통과
React Native TypeScript 검사 통과
```
