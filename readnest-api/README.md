# ReadNest API

NestJS, Prisma, MySQL 기반 ReadNest 백엔드입니다.

현재 범위는 Threads 전용 MVP의 백엔드 기본 구조입니다.

## Setup

```bash
npm install
```

환경 변수 파일을 만듭니다.

```bash
cp .env.local-mysql.example .env
```

Homebrew MySQL이 이미 `localhost:3306`에서 실행 중이면 `docs/mysql-setup.md`의 Option A를 따라 DB와 계정을 만듭니다.

Docker MySQL을 사용하려면 Docker Desktop을 실행한 뒤 아래 명령을 사용합니다.

```bash
cp .env.docker.example .env
docker compose up -d
```

요약 큐 처리를 위해 Redis도 필요합니다. Docker를 쓰는 경우 `docker compose up -d`로 MySQL과 Redis가 함께 실행됩니다.

Homebrew MySQL을 쓰는 경우 Redis는 별도로 실행합니다.

```bash
brew install redis
brew services start redis
```

Prisma Client를 생성합니다.

```bash
npx prisma generate
```

첫 마이그레이션은 DB 실행 후 아래 명령으로 진행합니다.

```bash
npx prisma migrate dev --name init
```

MySQL 접속 오류가 나면 [MySQL Setup](./docs/mysql-setup.md)을 확인합니다.

## Run

```bash
npm run start
```

`npm run start`와 `npm run start:prod`는 모두 빌드된 `dist/main.js`를 실행합니다.

개발 모드:

```bash
npm run start:dev
```

Health Check:

```text
GET /api/health
```

## Auth API

회원가입:

```http
POST /api/auth/signup
Content-Type: application/json

{
  "email": "readnest@example.com",
  "password": "ReadNest2026!",
  "nickname": "ReadNest"
}
```

로그인:

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "readnest@example.com",
  "password": "ReadNest2026!"
}
```

내 정보:

```http
GET /api/auth/me
Authorization: Bearer <accessToken>
```

## Articles API

모든 Articles API는 JWT가 필요합니다.

```http
Authorization: Bearer <accessToken>
```

URL 저장:

```http
POST /api/articles
Content-Type: application/json

{
  "url": "https://www.threads.net/@example/post/123",
  "title": "개발자 포트폴리오를 개선하는 방법"
}
```

목록 조회:

```http
GET /api/articles?period=today&readStatus=UNREAD&limit=20
```

사용 가능한 `period`:

```text
today, week, last-week, month, all
```

상세 조회:

```http
GET /api/articles/:id
```

중복 확인:

```http
GET /api/articles/check-duplicate?url=https://www.threads.net/@example/post/123
```

읽음 상태 변경:

```http
PATCH /api/articles/:id/read-status
Content-Type: application/json

{
  "readStatus": "READ_LATER"
}
```

사용 가능한 `readStatus`:

```text
UNREAD, READ, READ_LATER
```

삭제:

```http
DELETE /api/articles/:id
```

## Summary Queue

URL 저장 시 article은 `SUMMARIZING` 상태로 생성되고 BullMQ summary queue에 작업이 등록됩니다.

`GEMINI_API_KEY`가 설정되어 있으면 Gemini API로 실제 요약을 생성하고, 키가 없거나 실패하면 fallback 요약을 저장합니다.

요약 상태 조회:

```http
GET /api/articles/:articleId/summary/status
Authorization: Bearer <accessToken>
```

요약 재시도:

```http
POST /api/articles/:articleId/summary/retry
Authorization: Bearer <accessToken>
```

Redis 환경 변수:

```env
REDIS_URL=""
REDIS_HOST="localhost"
REDIS_PORT=6379
REDIS_USERNAME=""
REDIS_PASSWORD=""
REDIS_TLS=false
```

`REDIS_URL`이 설정되어 있으면 URL 값을 우선 사용합니다. `rediss://` URL은 TLS Redis로 처리합니다.

Gemini 환경 변수:

```env
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
```

운영/사용량 제한 환경 변수:

```env
NODE_ENV="production"
PORT=3000
DAILY_SAVE_LIMIT=50
SUMMARY_RETRY_LIMIT=3
PLAYWRIGHT_CHANNEL="chrome"
PLAYWRIGHT_PAGE_TIMEOUT_MS=45000
PLAYWRIGHT_SCROLL_COUNT=3
EXTRACT_TEXT_LIMIT=50000
```

요약 결과 구조:

- `summary`: 상세 화면 표시용 구조화 텍스트
- `summaryMeta`: 요약 유형, 한 줄 요약, 핵심 요약, 읽을 가치, 주의점, 맥락 상태, 연속 글 상태, 요약 신뢰도 JSON
- `keyPoints`: 주요 포인트 배열
- `tags`: 태그 배열
- `extractionStatus`: 원문 추출 상태
- `extractionConfidence`: 원문 추출 신뢰도
- `summaryRetryCount`: 수동 재시도 횟수
- `lastSummaryError`: 마지막 요약 실패 원인

새 DB 필드가 추가되었으므로 기존 로컬 DB는 아래 명령으로 마이그레이션합니다.

```bash
npx prisma migrate dev
```

## KoDeploy 배포

권장 입력값:

```text
Repository: SmileCheetah/ReadNest
Branch: main
App Directory: readnest-api
Port: 3000
Dockerfile Path: readnest-api/Dockerfile
Build Command: npm run build
Start Command: npm run start
```

KoDeploy가 Dockerfile을 사용하지 않고 Nixpacks를 사용할 경우 `nixpacks.toml`이 Node 22, `npm run build`, `npm run start:prod`를 지정합니다. Nixpacks install phase에서 이미 `npm ci`가 실행되므로 build command에 `npm ci`를 다시 넣지 않습니다.

필수 환경변수:

```env
DATABASE_URL=
NODE_ENV=production
PORT=3000
JWT_SECRET=
JWT_EXPIRES_IN=7d
REDIS_URL=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
DAILY_SAVE_LIMIT=50
SUMMARY_RETRY_LIMIT=3
PLAYWRIGHT_PAGE_TIMEOUT_MS=45000
PLAYWRIGHT_SCROLL_COUNT=3
EXTRACT_TEXT_LIMIT=50000
```

`DATABASE_URL` 대신 KoDeploy DB 변수를 사용할 수도 있습니다.

```env
DB_HOST=
DB_PORT=3306
DB_NAME=
DB_USER=
DB_PASSWORD=
```

재배포 후 런타임 로그에서 아래 문구를 확인합니다.

```text
ReadNest API listening on port 3000
Connected to database
```

## Content Extraction

MVP에서는 Threads 공식 API를 사용하지 않습니다.

URL 저장 후 worker가 다음 순서로 콘텐츠를 추출합니다.

- URL fetch
- Open Graph title / description 확인
- HTML 태그 제거 후 본문 텍스트 추출
- 추출 텍스트가 부족하면 `CONTEXT_INSUFFICIENT` 처리

Threads 페이지는 동적 렌더링이나 접근 제한이 있을 수 있으므로, 초기 MVP에서는 메타데이터와 URL/title 기반 요약을 fallback으로 사용합니다.

## Deep Link Save

모바일 앱은 MVP 단계에서 아래 딥링크를 처리합니다.

```text
readnest://save?url=https%3A%2F%2Fwww.threads.net%2F...
```

OS 공유 시트에서 ReadNest를 직접 선택하는 기능은 개발 빌드/EAS 단계에서 Expo share intent 구성이 필요합니다.

## Test

```bash
npm run test
```
