# ReadNest 작업 기준 문서

이 문서는 ReadNest를 개발할 때 매번 먼저 확인할 기준 문서입니다. 원본 기획서는 `docs/PROJECT_BRIEF.md`에 보관하고, 실제 구현 판단은 이 문서를 우선 기준으로 삼습니다.

## 프로젝트 핵심

ReadNest는 SNS와 웹에서 발견한 유용한 글을 공유 한 번으로 저장하고, AI가 제목, 짧은 요약, 핵심 포인트, 태그를 생성해 날짜별 아카이브로 정리하는 개인 지식 큐레이션 서비스입니다.

핵심 가치는 저장 자체가 아니라 저장한 글을 다시 읽기 쉬운 형태로 바꾸는 것입니다.

## 확정 기술 스택

- Backend: NestJS, TypeScript
- Database: MySQL
- ORM: Prisma
- Auth: JWT
- Queue: Redis, BullMQ
- AI summary: OpenAI 또는 Gemini API
- Frontend: Next.js 또는 React
- Deployment: Docker 고려

기획서에는 PostgreSQL 또는 MySQL이라고 되어 있지만, 현재 프로젝트는 MySQL을 기준으로 진행합니다.

## MVP 핵심 흐름

1. 사용자가 URL을 저장한다.
2. 서버는 URL 중복 여부를 확인한다.
3. 저장글을 `요약 중` 상태로 생성한다.
4. 요약 작업을 BullMQ 큐에 등록한다.
5. Worker가 원문 추출과 AI 요약을 처리한다.
6. 제목, 요약, 핵심 포인트, 태그, 처리 상태를 DB에 저장한다.
7. 사용자는 날짜별 목록에서 저장글을 확인한다.
8. 사용자는 상세 화면에서 요약과 원문 링크를 확인한다.
9. 사용자는 읽음, 안 읽음, 나중에 다시 보기 상태를 변경한다.

초기 개발 단계에서는 외부 앱 공유 기능 대신 URL 직접 입력 API로 흐름을 검증합니다. 공유 기반 저장은 MVP 후반에 붙입니다.

## 우선순위

1. 인증
2. URL 저장
3. 중복 저장 처리
4. 저장글 목록 조회
5. 저장글 상세 조회
6. 읽음 상태 변경
7. 요약 작업 큐 등록
8. AI 요약 결과 저장
9. 요약 실패 재시도
10. 연속 글 감지
11. 공유 저장 연동

## MVP에서 제외

- 좋아요 자동 수집
- Threads 댓글 자동 수집
- Chrome 확장 프로그램
- iOS Share Extension
- 관심사 그래프
- 주간, 월간 리포트
- 알림 기능
- YouTube 영상 요약
- GitHub Star 연동

## NestJS 설계 원칙

- Controller는 요청과 응답만 담당합니다.
- Service는 비즈니스 로직을 담당합니다.
- DTO는 요청 데이터 검증을 담당합니다.
- PrismaService 또는 Repository 계층은 데이터 접근을 담당합니다.
- 예외는 NestJS의 HTTP Exception 구조를 사용합니다.
- AI 요약은 API 요청 중 직접 처리하지 않고 BullMQ Worker에서 처리합니다.
- 처음부터 과도한 추상화를 만들지 않습니다.

## MySQL 데이터 모델 초안

### User

사용자 계정과 저장글 소유권을 구분합니다.

- `id`
- `email`
- `passwordHash`
- `nickname`
- `createdAt`
- `updatedAt`

### SavedArticle

사용자가 저장한 하나의 콘텐츠입니다.

- `id`
- `userId`
- `source`
- `url`
- `normalizedUrl`
- `title`
- `author`
- `rawText`
- `summary`
- `keyPoints`
- `tags`
- `processStatus`
- `readStatus`
- `savedAt`
- `createdAt`
- `updatedAt`

권장 제약:

- `userId`, `normalizedUrl` 복합 유니크 인덱스
- `userId`, `savedAt` 인덱스
- `userId`, `processStatus` 인덱스
- `userId`, `readStatus` 인덱스

### ThreadGroup

Threads처럼 여러 파트로 나뉜 글을 하나로 묶기 위한 모델입니다.

- `id`
- `userId`
- `title`
- `status`
- `createdAt`
- `updatedAt`

### ThreadPart

연속 글 묶음 안의 개별 파트입니다.

- `id`
- `threadGroupId`
- `savedArticleId`
- `partNumber`
- `totalParts`
- `url`
- `createdAt`

권장 제약:

- `threadGroupId`, `partNumber` 복합 유니크 인덱스

## 상태 값

### 처리 상태

- `SAVED`
- `SUMMARIZING`
- `SUMMARY_DONE`
- `SUMMARY_FAILED`
- `CONTEXT_INSUFFICIENT`

### 읽음 상태

- `UNREAD`
- `READ`
- `READ_LATER`

### 연속 글 묶음 상태

- `PARTIAL`
- `COMPLETE`
- `MERGED_SUMMARY_DONE`

## API 초안

### Auth

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`

로그아웃은 프론트에서 토큰을 삭제하는 방식으로 시작합니다.

### Saved Articles

- `POST /articles`
- `GET /articles`
- `GET /articles/:id`
- `DELETE /articles/:id`
- `GET /articles/check-duplicate?url=...`
- `PATCH /articles/:id/read-status`

### Summary

- `POST /articles/:id/summary`
- `GET /articles/:id/summary/status`
- `POST /articles/:id/summary/retry`

### Thread Groups

- `POST /articles/:id/thread-detection`
- `GET /thread-groups/:id`
- `POST /thread-groups/:id/summary`

## AI 요약 정책

- 요약 결과에는 제목, 짧은 요약, 핵심 포인트, 태그가 포함되어야 합니다.
- 태그는 3개에서 5개로 제한합니다.
- 원문만으로 맥락이 부족하면 `CONTEXT_INSUFFICIENT` 상태를 사용합니다.
- 연속 글 일부만 저장된 경우 전체 내용을 단정하지 않습니다.
- 광고성 문구, 과장된 감탄 표현, 불필요한 반복은 제거합니다.
- 사용자에게 보여줄 요약은 짧고 명확하게 작성합니다.

## UI 방향

- Notion처럼 차분하고 정리된 느낌을 목표로 합니다.
- 흰 배경과 연한 회색 구분선을 중심으로 구성합니다.
- 텍스트 중심 카드로 저장글을 보여줍니다.
- 태그는 작은 pill 형태로 표시합니다.
- 상태는 명확한 라벨로 보여줍니다.
- 핵심 화면은 홈, 아카이브, 상세, 설정으로 유지합니다.

## 앞으로 작업할 때 확인할 것

- 새 기능이 MVP 핵심 흐름에 직접 연결되는가?
- API 요청 중 오래 걸리는 작업을 직접 처리하고 있지는 않은가?
- MySQL과 Prisma 제약 조건으로 중복 저장을 막고 있는가?
- 사용자의 저장글 소유권을 모든 조회, 수정, 삭제에서 확인하는가?
- 목록 화면이 날짜별 조회에 필요한 필드를 충분히 제공하는가?
- 실패 상태와 재시도 흐름이 있는가?
- 향후 개발 우선순위와 배포 기준은 `docs/ROADMAP_AND_RELEASE_CRITERIA.md`를 기준으로 확인한다.

## 구현 예정 목록

- 홈 화면 상단에 `오늘 읽을 글` 섹션을 추가합니다.
- `오늘 읽을 글`은 요약 완료 + 안 읽음 상태인 글 중 최근 저장순 3개를 추천하는 방식으로 시작합니다.
- 전체 안 읽은 글을 압박하듯 보여주지 않고, `오늘은 이 3개만 가볍게 읽어보세요` 같은 부담 적은 문구를 사용합니다.
- 이후 `나중에 다시 보기`, 오래 방치된 글, 자주 보는 태그, 요약 신뢰도를 추천 로직에 반영합니다.
- 요약된 내용을 상세 화면에서 바로 복사하는 기능을 추가합니다.
- 요약된 내용을 OS 공유 시트로 바로 공유하는 기능을 추가합니다.
- 복사/공유 대상은 우선 `제목`, `AI 요약`, `주요 포인트`, `원본 링크` 조합으로 검토합니다.
- 현재는 예정 항목으로만 기록하고, 바로 구현하지 않습니다.
