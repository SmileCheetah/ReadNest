# 로컬 실행 확인 — 2026-09-29

## 실행 대상

- checkout: `/Users/m3air/Desktop/Code/Node/ReadNest`, `main`
- API: `http://127.0.0.1:3001/api` (development watch)
- Expo web: `http://localhost:8081`
- Metro: `exp://127.0.0.1:8081`
- MySQL: 기존 로컬 Docker DB, port 3307. Redis: 기존 로컬 port 6379.
- port 3000은 다른 프로젝트가 사용 중이므로 해당 프로세스를 중단하지 않았다.

환경 파일은 수정하지 않았다. 다시 시작할 때에는 각 디렉터리에서 포트 override를 함께 전달한다.

```sh
# readnest-api
PORT=3001 NODE_ENV=development npm run start:dev

# readnest-mobile
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3001/api npx expo start --localhost --port 8081 --clear
```

Expo 터미널의 `w`로 웹 화면을 열 수도 있다. 위 localhost 설정은 이 Mac의 웹 테스트용이며, 실기기에서는 기기가 접근할 수 있는 API 주소와 Metro 연결 설정이 별도로 필요하다.

## DB 적용

기존 worker가 실행 중이지 않고 저장 글에 처리 중 상태가 없음을 확인했다. 로컬 DB를 백업한 후 Prisma Client 생성과 `prisma:migrate:deploy`를 실행했다.

- 적용: `20260929000000_durable_summary_tasks`
- 적용 전후 저장 글: 11개
- 적용 후 대기/실행 task: 0개
- 백업: `/tmp/readnest-startup-backup.lRE2Rw/before-durable-summary.sql` (파일 mode 600, 디렉터리 mode 700)

백업은 임시 경로에 있으므로 영구 보관용이 아니다. 내용과 환경 비밀 값은 저장소에 기록하지 않는다. 운영 DB에는 실행하지 않았다.

## 개발 웹 CORS 결정

**문제 →** 서버는 정상이지만 Expo web의 인증 요청 preflight가 404이고 허용 origin 응답이 없었다.

**가능한 선택지 →** 웹 proxy 구성 / 모든 origin 허용 / 개발 origin만 제한적으로 허용.

**선택한 방법 →** `NODE_ENV=development`일 때만 `http://localhost:8081`, `http://127.0.0.1:8081`을 허용한다. Bearer 인증과 멱등 요청에 필요한 헤더만 허용하며 교차 출처 쿠키는 허용하지 않는다.

**선택 이유 →** 기존 인증·API 계약과 운영 환경을 바꾸지 않고 현재 웹 개발 연결을 복구한다.

**트레이드오프 →** 다른 웹 포트나 LAN origin은 별도 검토가 필요하다. CORS는 인증이나 네트워크 접근 제어를 대체하지 않는다. production에는 이 개발 설정을 적용하지 않는다.

## 확인 결과와 범위

- API health: HTTP 200, database `ok`
- Expo web HTML: HTTP 200
- 허용 origin OPTIONS: HTTP 204 및 정확한 `Access-Control-Allow-Origin`
- 외부 origin OPTIONS: 허용 origin 헤더 없음
- 빈 로그인 요청: HTTP 400 입력 검증 응답 및 로컬 origin 헤더 (계정 생성/인증 우회 없음)
- 개발 CORS 단위 테스트: 1 suite / 4 tests 통과
- watch TypeScript 컴파일: 오류 0개
- 기존 저장 글·환경 파일·다른 앱 프로세스 보존
- 독립 코드 리뷰: 차단 결함 없음

앱 내 브라우저 자동 연결이 timeout되어 실제 렌더링 화면은 이번 실행 점검에서 확인하지 못했다. 기존 UI 검증 결과와 혼동하지 않는다. 로그인 후 실제 저장→원문 수집→Luna 요약→읽음 반영은 사용자가 웹 화면에서 이어서 확인한다. 이번 startup 점검은 새 유료 AI 호출이나 재요약을 실행하지 않았다.
