# ReadNest

SNS와 웹에서 발견한 유용한 글을 공유 한 번으로 저장하고, AI가 요약하여 날짜별 아카이브로 정리해주는 개인 지식 큐레이션 서비스입니다.

## 문서

- [원본 기획서](./docs/PROJECT_BRIEF.md)
- [작업 기준 문서](./docs/WORKING_NOTES.md)
- [MVP 구현 계획](./docs/MVP_PLAN.md)
- [진행상황 기록](./docs/PROGRESS_LOG.md)
- [남은 작업 정리](./docs/REMAINING_WORK.md)

## 현재 결정 사항

- Backend: NestJS, TypeScript (`readnest-api`)
- Database: MySQL
- ORM: Prisma
- Auth: JWT
- Async jobs: Redis, BullMQ
- AI summary: OpenAI 또는 Gemini API
- Frontend: React Native / Expo (`readnest-mobile`)

## 현재 구현 상태

- JWT 기반 회원가입, 로그인, 내 정보 조회
- 사용자별 Threads URL 저장, 목록, 상세, 삭제
- 중복 URL 방지와 읽음 상태 관리
- Redis/BullMQ 기반 비동기 요약 큐
- Gemini API 기반 AI 요약과 fallback 요약
- Playwright/fetch 기반 원문 추출
- React Native 앱의 홈, 아카이브, 상세, 설정 화면
- 요약 복사, OS 공유, 재시도 버튼 1차 구현

## 로컬 실행

### 1. 백엔드 준비

```bash
cd /Users/m3air/Desktop/Code/Node/ReadNest/readnest-api
npm install
cp .env.local-mysql.example .env
```

Homebrew MySQL과 Redis를 사용할 경우:

```bash
brew services start mysql
brew services start redis
```

Docker를 사용할 경우 Docker Desktop을 켠 뒤:

```bash
cp .env.docker.example .env
docker compose up -d
```

Prisma Client와 DB migration:

```bash
npm run prisma:generate
npm run prisma:migrate
```

API 서버 실행:

```bash
npm run start:dev
```

Health check:

```text
GET http://localhost:3000/api/health
```

### 2. 모바일 앱 준비

```bash
cd /Users/m3air/Desktop/Code/Node/ReadNest/readnest-mobile
npm install
cp .env.example .env.local
npm run start -- --clear
```

iOS 시뮬레이터에서는 기본값인 `http://localhost:3000/api`로 API 서버에 접근할 수 있습니다.

실제 기기에서 Expo Go로 테스트할 때는 `.env.local`에 Mac의 LAN IP를 넣습니다.

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.4:3000/api
```

### 3. 백엔드 배포 참고

`readnest-api`는 배포 환경에서 다음 기준으로 실행합니다.

```text
Root Directory: readnest-api
Runtime: Dockerfile 또는 Node.js
App Directory: readnest-api
Port: 3000
Dockerfile Path: readnest-api/Dockerfile
Build Command: npm run build
Start Command: npm run start 또는 npm run start:prod
Node: >=20.11.0, 권장 22
```

KoDeploy가 Dockerfile을 사용하면 `readnest-api/Dockerfile` 기준으로 Node 22 멀티 스테이지 빌드를 수행합니다.

Nixpacks를 사용하는 경우에는 `readnest-api/nixpacks.toml`을 기준으로 install phase에서 `npm ci`, build phase에서 `npm run build`, start phase에서 `npm run start:prod`가 실행됩니다.

KoDeploy가 시작 명령어를 자동으로 `npm run start`로 잡아도 운영 빌드 결과인 `dist/main.js`를 실행하도록 설정되어 있습니다.

필수 환경변수:

```env
DB_HOST=
DB_PORT=3306
DB_NAME=
DB_USER=
DB_PASSWORD=
NODE_ENV=production
PORT=3000
JWT_SECRET=
JWT_EXPIRES_IN=7d
REDIS_URL=
REDIS_HOST=
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_TLS=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
DAILY_SAVE_LIMIT=50
SUMMARY_RETRY_LIMIT=3
PLAYWRIGHT_CHANNEL=chrome
PLAYWRIGHT_PAGE_TIMEOUT_MS=45000
PLAYWRIGHT_SCROLL_COUNT=3
EXTRACT_TEXT_LIMIT=50000
```

KoDeploy에서 MySQL 의존성을 사용하는 경우 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`만 등록하면 됩니다. 앱 시작 시 `mysql://DB_USER:DB_PASSWORD@DB_HOST:DB_PORT/DB_NAME` 형식의 `DATABASE_URL`을 자동 생성합니다.

다른 배포 환경이나 로컬 개발에서는 `DATABASE_URL`을 직접 넣어도 됩니다. 우선순위는 `DATABASE_URL` 직접 값, 그다음 `DB_*` 조합입니다.

`PORT`는 KoDeploy 앱 포트와 같은 값이어야 합니다. API는 `0.0.0.0`에 바인딩되도록 설정되어 있습니다.

## 환경변수

### API

`readnest-api/.env.example` 또는 `readnest-api/.env.local-mysql.example`을 기준으로 설정합니다.

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | MySQL 접속 문자열. 있으면 우선 사용 |
| `DB_HOST` | `DATABASE_URL`이 없을 때 사용할 DB host |
| `DB_PORT` | `DATABASE_URL`이 없을 때 사용할 DB port |
| `DB_NAME` | `DATABASE_URL`이 없을 때 사용할 DB name |
| `DB_USER` | `DATABASE_URL`이 없을 때 사용할 DB user |
| `DB_PASSWORD` | `DATABASE_URL`이 없을 때 사용할 DB password |
| `NODE_ENV` | 실행 환경. 배포에서는 `production` 권장 |
| `PORT` | NestJS API 서버 포트 |
| `JWT_SECRET` | JWT 서명 secret |
| `JWT_EXPIRES_IN` | access token 만료 시간 |
| `REDIS_URL` | Redis 접속 URL. 있으면 `REDIS_HOST`, `REDIS_PORT`보다 우선 |
| `REDIS_HOST` | Redis host |
| `REDIS_PORT` | Redis port |
| `REDIS_USERNAME` | Redis username. 필요한 서비스에서만 사용 |
| `REDIS_PASSWORD` | Redis password. 필요한 서비스에서만 사용 |
| `REDIS_TLS` | Redis TLS 사용 여부. `true`이면 TLS 활성화 |
| `GEMINI_API_KEY` | Gemini API key. 비어 있으면 fallback 요약 사용 |
| `GEMINI_MODEL` | Gemini 요약 모델 |
| `DAILY_SAVE_LIMIT` | 사용자별 하루 저장 제한 |
| `SUMMARY_RETRY_LIMIT` | 요약 수동 재시도 제한 |
| `PLAYWRIGHT_CHANNEL` | Playwright 브라우저 channel |
| `PLAYWRIGHT_PAGE_TIMEOUT_MS` | 페이지 로딩 timeout |
| `PLAYWRIGHT_SCROLL_COUNT` | Threads 추출 시 스크롤 횟수 |
| `EXTRACT_TEXT_LIMIT` | 요약에 전달할 원문 최대 길이 |

### Mobile

`readnest-mobile/.env.example`을 기준으로 설정합니다.

| 변수 | 설명 |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | 모바일 앱이 호출할 ReadNest API 주소 |

## 검증 명령

API:

```bash
cd readnest-api
npm run build
npm test -- --runInBand
```

Mobile:

```bash
cd readnest-mobile
npm run typecheck
```

## 개발 원칙

- MVP 흐름을 먼저 안정적으로 완성합니다.
- 기능은 작은 단위로 나누어 구현합니다.
- NestJS의 Controller, Service, DTO, Module 구조를 명확히 유지합니다.
- 데이터 접근은 Prisma를 통해 처리합니다.
- 요약 처리는 API 요청 안에서 직접 수행하지 않고 큐 기반 비동기 작업으로 분리합니다.
