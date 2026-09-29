# 개발용 게스트 모드 구현 계획

## 목표

개발 중에는 로그인·회원가입 화면을 거치지 않고 앱을 바로 사용할 수 있게 한다. 기존 인증 코드는 삭제하거나 주석으로 방치하지 않고 운영 빌드에서 계속 사용할 수 있도록 보존한다.

## 현재 제약

- 글 저장·목록·상세·읽음·삭제·재요약 API는 모두 JWT 인증을 요구한다.
- Frontend에서 로그인 화면만 숨기면 토큰이 없어 모든 핵심 API가 실패한다.
- 하나의 공용 사용자 ID를 사용하면 여러 기기의 저장 글이 섞이고 개인정보가 노출될 수 있다.
- 익명 토큰만 새로 발급하면 토큰 만료 후 기존 게스트 데이터에 다시 접근할 방법이 없다.

## 선택한 방식

### 문제 → 선택지 → 결정 → 이유 → 트레이드오프

| 문제 | 선택지 | 결정 | 이유 | 트레이드오프 |
| --- | --- | --- | --- | --- |
| 로그인 없는 API 접근 | 인증 제거 / 공용 계정 / 익명 JWT | 기기별 익명 계정과 JWT | 기존 권한 검사와 사용자별 데이터 격리를 유지 | 내부적으로는 익명 인증 과정이 존재 |
| 게스트 재접속 | 매번 새 계정 / 영구 토큰 / 기기 식별키 | SecureStore의 무작위 기기 식별키 | 토큰이 만료돼도 같은 게스트 계정을 복구 | 앱 삭제 시 식별키도 사라져 계정 복구 불가 |
| 운영 환경 안전성 | 항상 게스트 허용 / 환경별 제어 | 개발·테스트 환경에서만 허용 | 익명 가입 남용과 운영 데이터 위험 방지 | 운영 빌드에는 기존 로그인이 표시됨 |
| 기존 로그인 코드 | 삭제 / 주석 처리 / 보존 | 렌더링만 우회하고 코드 보존 | 나중에 인증을 되살릴 때 회귀 위험이 낮음 | 사용하지 않는 UI 코드가 당분간 남음 |

## 동작 흐름

1. 앱 시작 시 기존 JWT를 복구한다.
2. 유효한 JWT가 있으면 기존 사용자 또는 게스트 세션을 그대로 사용한다.
3. JWT가 없거나 만료됐고 개발 게스트 모드이면 기기 식별키를 불러온다.
4. 식별키가 없으면 암호학적으로 안전한 UUID를 생성해 SecureStore에 저장한다.
5. `POST /api/auth/guest`로 기기 식별키를 보내 동일한 익명 사용자와 JWT를 발급받는다.
6. 이후 글 API는 기존과 똑같이 JWT를 사용한다.

## 보안 경계

- 원본 기기 식별키는 DB에 저장하지 않는다.
- Backend는 `JWT_SECRET` 기반 HMAC으로 익명 이메일 키를 파생한다.
- 게스트 endpoint는 `NODE_ENV=production`에서 항상 거부한다.
- 기기마다 별도 사용자 행을 사용하며 공용 계정을 만들지 않는다.
- 기존 Controller의 JWT guard와 사용자 소유권 검사를 제거하지 않는다.
- Web 개발 미리보기는 탭의 `sessionStorage`에만 식별키를 보관한다.

## 변경 예정 파일

### Backend

- `readnest-api/src/auth/dto/guest-session.dto.ts`
- `readnest-api/src/auth/auth.controller.ts`
- `readnest-api/src/auth/auth.service.ts`
- `readnest-api/src/auth/auth.service.spec.ts`
- Backend 환경변수 예시와 README

### Frontend

- `readnest-mobile/src/config/authMode.ts`
- `readnest-mobile/src/api/guestIdentityStorage.ts`
- `readnest-mobile/src/api/readnestApi.ts`
- `readnest-mobile/App.tsx`
- Expo dependency 및 환경변수 예시와 README

## 상태 및 오류 처리

- 자동 게스트 세션 생성 중에는 `앱을 준비하는 중…`을 표시한다.
- Backend가 꺼져 있거나 구버전이면 로그인 화면으로 되돌아가지 않고 재시도 가능한 연결 오류를 표시한다.
- 유효하지 않은 기존 JWT는 지운 뒤 같은 기기 식별키로 게스트 세션을 복구한다.
- 게스트 설정 화면에는 합성 이메일이나 로그아웃 버튼을 노출하지 않는다.

## 테스트 계획

- 같은 기기 식별키는 같은 게스트 사용자를 반환
- 다른 기기 식별키는 다른 사용자를 반환
- 원본 식별키가 DB 필드나 API 응답에 노출되지 않음
- production 환경에서 guest endpoint 거부
- 로그인·회원가입 endpoint와 기존 JWT API 회귀 없음
- Frontend typecheck와 전체 테스트
- Backend build, test, lint
- 로그인 화면 없이 홈 진입하는 합성 API 시각 검사

## 완료 조건

- 개발 앱 실행 시 로그인 화면 없이 홈이 열린다.
- 저장·요약·읽음·삭제가 기존 JWT 경로로 동작한다.
- 앱 재시작 및 JWT 만료 후에도 같은 게스트 계정으로 복구할 수 있다.
- 운영 빌드의 로그인 흐름은 변경되지 않는다.
- 기존 글 API 계약과 DB migration 변경 없이 구현된다.

## 구현 및 검증 결과

- 개발 빌드에서 로그인 화면 없이 `POST /api/auth/guest`로 자동 진입
- UUID v4 기기 식별키를 SecureStore에 보관하고 Backend에는 원문 미저장
- HMAC 파생 키로 기기별 사용자 데이터 격리
- 기존 JWT guard와 글 소유권 검사 유지
- 운영 환경에서 게스트 endpoint 강제 거부
- 게스트 설정 화면에서 합성 이메일과 로그아웃 액션 숨김
- Backend `npm run build` 통과
- Backend 테스트: 13 suites / 102 tests 통과
- Backend lint: 오류 0건, 기존 `main.ts` 경고 1건
- Frontend 테스트: 7 suites / 63 tests 통과
- Frontend `npm run typecheck` 통과
- Expo Web 합성 API 검사에서 로그인 입력 없이 홈·상세 진입 확인
- 390px 및 320px 렌더링, 가로 overflow 없음
