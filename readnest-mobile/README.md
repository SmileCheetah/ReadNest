# ReadNest Mobile

Threads 저장과 AI 요약 흐름을 확인하기 위한 React Native 앱 프론트입니다.

## 실행

```bash
npm install
npm run start
```

Expo Go 앱으로 QR 코드를 스캔하면 모바일에서 확인할 수 있습니다.

## 화면

- 로그인 / 회원가입
- 홈: Threads URL 저장, 오늘 저장글, 요약 중, 안 읽음 목록
- 아카이브: 기간 탭, 검색, 저장된 Thread 목록
- 상세: AI 요약, 주요 포인트, 태그, 원본 링크 버튼, 연속 Thread 감지 상태
- 설정: 계정, 요약 언어, 저장 대상, 로그아웃

## API 연결

현재 앱은 ReadNest API와 직접 통신합니다.

기본 API 주소:

```text
http://localhost:3000/api
```

위 값은 `EXPO_PUBLIC_API_BASE_URL` 환경변수로 바꿀 수 있습니다.

iOS 시뮬레이터에서는 `localhost`로 Mac의 API 서버에 접근할 수 있습니다. 실제 기기에서 Expo Go로 테스트할 때는 `localhost`가 기기 자신을 의미하므로 Mac의 LAN IP로 바꿔야 합니다.

예:

```bash
cp .env.example .env.local
```

`.env.local`:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.4:3000/api
```

먼저 API 서버를 실행합니다.

```bash
cd ../readnest-api
npm run start
```

그 다음 모바일 앱을 실행합니다.

```bash
cd ../readnest-mobile
npm run start -- --clear
```

## 로그인 유지

로그인 성공 시 access token을 `expo-secure-store`에 저장합니다.

앱 재시작 시 저장된 token으로 `GET /api/auth/me`를 호출해 세션을 복구합니다.

## Deep Link Save

아래 딥링크를 열면 앱이 URL을 감지해 저장 입력칸에 채웁니다.

```text
readnest://save?url=https%3A%2F%2Fwww.threads.net%2F...
```

Expo Go에서는 네이티브 공유 시트 수신을 완전히 검증하기 어렵습니다. OS 공유 대상 등록은 개발 빌드/EAS 단계에서 추가 구성해야 합니다.

## Development Build / OS Share 준비

OS 공유 시트에서 ReadNest를 직접 선택하는 흐름은 Expo Go만으로는 완성 검증이 어렵습니다.

현재 준비된 항목:

- `app.json`에 iOS bundle identifier와 Android package 설정
- `eas.json` 개발 빌드 프로필 추가
- 딥링크 scheme `readnest` 유지

개발 빌드 후보 명령:

```bash
npx expo install expo-dev-client
npx eas build --profile development --platform ios
npx eas build --profile development --platform android
```

추가로 검토할 항목:

- iOS Share Extension 또는 공유 intent 처리 플러그인
- Android intent-filter 기반 공유 payload 수신
- 공유 payload에서 URL을 추출해 `readnest://save?url=...` 흐름으로 연결
- 실제 기기에서 Threads 공유 버튼으로 저장 검증

## 디자인 기준

- Notion 스타일의 따뜻한 off-white 배경
- 흰색 카드와 연한 회색 hairline border
- Inter 계열의 문서형 타이포그래피
- 구조적 강조색은 파란색 하나만 사용
- Threads 전용 MVP 기준

## macOS Metro watcher 참고

개발 서버 실행 중 `EMFILE: too many open files, watch` 오류가 나면 Watchman 설치가 필요할 수 있습니다.

```bash
brew install watchman
npm run start
```
