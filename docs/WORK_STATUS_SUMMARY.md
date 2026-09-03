# ReadNest 작업 상태 요약

2026-09-03 기준 문서입니다.

## 한 줄 요약

프로젝트 내부명은 ReadNest이며, Google Play 테스트 출시 앱 이름은 `Unwind`로 정리했습니다. 핵심 MVP 기능은 대부분 구현된 상태이며, 지금은 실제 운용 검증과 Play Store Internal testing 준비를 진행하는 단계입니다.

## 구현 완료된 상태

### 백엔드

- 인증: 회원가입, 로그인, JWT, 보호 API
- 저장글 CRUD: 생성, 목록, 상세, 삭제
- 상태 관리: UNREAD, READ, READ_LATER
- 요약 큐: Redis + BullMQ 기반 비동기 작업
- AI 요약: 원문 추출, Gemini 요약, 핵심 포인트, 태그 생성
- Thread 감지: 연속 글/파트 연결 로직 1차 구현
- 배포 대응: 환경변수 검증, 서버 바인딩, start:prod, Docker/Nixpacks 정리

### 모바일

- 로그인 및 세션 복구
- 홈, 아카이브, 상세, 설정 화면
- 저장/삭제/읽음 상태 변경
- 요약 상태 표시
- API 주소 환경변수 분리
- 검색 및 필터 연결
- Expo SDK 57 및 Android API 36 업그레이드
- EAS 프로젝트/서명 키/Android preview APK 구성
- Google Play 개발자 계정 본인 확인 절차 제출 완료
- 앱 아이콘과 스플래시 구성

## 아직 남아 있는 핵심 과제

### 1) 실제 흐름 검증

- 로컬 통합 실행 확인
- 실제 Threads URL 저장 테스트
- 저장 → 요약 → 상세 확인 전체 플로우 QA
- 로그아웃 후 재로그인 흐름 점검

### 2) 사용자 경험 정리

- 요약 상태를 더 명확하게 표시
- 실패 상태 재시도 UX 강화
- 상세 화면에서 원문 추출과 요약 상태를 분리 표시
- 자동 갱신/새로고침 전략 확립

### 3) 품질 개선

- Threads 추출의 다양한 케이스 검증
- 실패/맥락 부족/신뢰도 케이스 구분
- 연속 Thread 통합 요약 설계
- 검색/필터 확장

### 4) 테스트 보강

- Auth service 테스트
- Articles service 테스트
- URL normalize 테스트
- 읽음 상태 및 중복 저장 테스트
- Summary retry / Thread detection 테스트
- e2e 테스트 추가

### 5) 배포 및 시연 준비

- 운영 DB, Redis 구성
- 공개 HTTPS API 배포
- Google Play Internal testing용 production AAB 업로드
- Google Play Console 등록 정보와 개인정보처리방침 준비
- 실제 기기 테스트
- 공유 저장 흐름 검토

Android 설치용 preview APK 빌드는 성공했으며, 다음 목표는 공개 HTTPS API를 연결한 production AAB를 Google Play Internal testing에 업로드하는 것입니다. 자세한 내용은 [ANDROID_RELEASE.md](./ANDROID_RELEASE.md)를 참고합니다.

## 추천 우선순위

1. 공개 HTTPS API 및 production 환경변수 확인
2. `Unwind` 이름으로 production AAB 빌드
3. Google Play Internal testing 업로드
4. 실제 Android 기기에서 저장-요약-조회 QA
5. 오류 수정 및 반복 배포

## 결론

지금 프로젝트는 “기능 구현의 80% 이상 완료” 상태이지만, 최종적으로는 실제 사용 검증과 안정화 단계로 넘어간 시점입니다. 가장 먼저 해야 할 일은 저장-요약-조회 흐름을 실제로 한 번 통째로 돌려보고, 남은 UX와 예외 상황을 정리하는 것입니다.
