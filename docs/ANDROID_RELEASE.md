# ReadNest Android 배포

최종 확인일: 2026-09-03

## 이번 테스트 출시 목표

이번 단계의 목표는 APK 파일을 직접 전달하는 것이 아니라, Google Play에 `Unwind`를 등록하고 **Internal testing** 트랙으로 본인 휴대폰에 설치하는 것입니다.

- Play 표시 이름: `Unwind`
- Android package: `com.readnest.mobile` (변경하지 않음)
- 배포 형식: Android App Bundle (`.aab`)
- 테스트 트랙: Google Play Internal testing
- 테스트 계정: Play Console에 등록한 본인 Google 계정

## 현재 상태

- Expo SDK 57 / React Native 0.86
- 앱 표시 이름 변경 예정: `Unwind` (프로젝트 `app.json`의 `expo.name`도 동일하게 맞출 것)
- Android package: `com.readnest.mobile`
- EAS project: `@kkzw18837/readnest-mobile`
- Android API 36 대응
- EAS 서명 키 생성 완료
- 설치용 preview APK 빌드 성공
- TypeScript, Expo Doctor, Android JS bundle 검사 통과

## 설치용 preview APK

EAS build ID:

```text
a17a0dca-c11c-43e1-915c-c4e084677b3b
```

빌드 상세:

```text
https://expo.dev/accounts/kkzw18837/projects/readnest-mobile/builds/a17a0dca-c11c-43e1-915c-c4e084677b3b
```

이 preview 빌드는 `.env.local`에 있던 로컬 네트워크 API 주소를 사용한다. Android 기기와 API 서버가 같은 네트워크에 있어야 하며 API 서버가 실행 중이어야 한다. 외부 배포용으로 사용하지 않는다.

새 preview APK:

```bash
cd readnest-mobile
npm run build:android:preview
```

## Google Play Internal testing용 production AAB

Play Store에서 설치한 앱은 로컬 API 주소(`localhost`, 사설 LAN IP)에 접근할 수 없다. 먼저 공개 HTTPS API를 배포하고 EAS production 환경변수를 등록한다.

```bash
npx eas-cli@latest env:create production \
  --name EXPO_PUBLIC_API_BASE_URL \
  --value https://YOUR_API_HOST/api \
  --visibility plaintext \
  --scope project
```

그 다음 AAB를 생성한다.

```bash
npm run build:android
```

빌드가 완료되면 EAS 빌드 결과에서 `.aab` 파일을 내려받는다.

## Play Console 업로드 순서

1. Play Console에서 첫 앱을 만든다.
2. 앱 이름은 `Unwind`, 유형은 `앱`, 가격은 `무료`로 설정한다.
3. `테스트 및 출시 → 테스트 → 내부 테스트`에서 테스트 트랙을 만든다.
4. 새 버전에 production AAB를 업로드한다.
5. 본인 Google 계정을 테스터 목록에 추가한다.
6. 변경사항을 검토하고 내부 테스트에 게시한다.
7. 생성된 참여 링크를 Android 휴대폰에서 열어 Play Store로 설치한다.

Internal testing 앱은 Play Store 검색으로 찾는 앱이 아니라 참여 링크로 설치한다. 첫 업로드 후 Play Console 검토 및 테스트 링크 활성화에 시간이 걸릴 수 있다.

EAS Submit을 사용하려면 Google Play 서비스 계정 연동이 별도로 필요하다. 처음에는 Play Console에서 AAB를 직접 업로드한다.

```bash
npm run submit:android
```

## 테스트 출시 전 확인

- 운영 API의 `/`와 `/api/health`가 HTTPS에서 정상 응답하는가
- production `EXPO_PUBLIC_API_BASE_URL`이 운영 API를 가리키는가
- 앱 로그인, 저장, 요약, 상세 조회, 삭제가 실제 기기에서 동작하는가
- 앱 아이콘과 스플래시가 정상적으로 표시되는가
- 개인정보처리방침 URL을 준비했는가
- Play Console 데이터 보안 및 콘텐츠 등급 정보를 작성했는가

## Play Console에서 필요한 항목

- Google Play 개발자 계정
- 앱 이름, 짧은 설명, 전체 설명
- 512x512 스토어 아이콘과 휴대전화 스크린샷
- 개인정보처리방침 공개 URL
- 데이터 보안 설문
- 콘텐츠 등급과 대상 연령
- 로그인 검토용 테스트 계정
- 계정 삭제 방법과 공개 안내 URL

2023-11-13 이후 생성된 개인 개발자 계정은 production 권한 신청 전에 12명 이상이 14일 연속 참여하는 closed test가 필요할 수 있다.

## iOS 후속 배포

운영 API와 개인정보처리방침이 준비되면 동일한 Expo 프로젝트에서 iOS production build와 TestFlight 제출을 진행한다. Apple Developer Program 가입과 App Store Connect 앱 생성이 필요하다.
