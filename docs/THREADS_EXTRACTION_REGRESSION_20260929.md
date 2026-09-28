# Threads 원문 누락·실패 회귀 수정

## 요구사항과 성공 조건

요약 스타일을 더 강제하지 않고, 짧은 정상 원문과 긴 연속 글 모두 올바르게 Luna에 전달한다. 200자 기준을 제거하되 로그인 UI를 원문으로 요약하지 않는다. 실패한 테스트 계정의 이력서 글과 짧아진 소프트웨어 역량 글을 실제 서비스 경로에서 재검증한다.

성공 기준: 요청한 post ID/작성자 일치, 동일 루트의 self-thread 순서 보존, 일반 댓글·추천·인용 글 제외, 요약 프롬프트/모델 유지, 기존 API·DB·단일 Markdown 화면 유지, 실제 생성 결과 확인.

## 확인된 원인

- 실패 글 `@incu_career/post/Dcz8gmbiXdw`: 기존 browser 결과 160자는 `Log in or sign up for Threads` 등의 안내 UI였다. 짧은 정상 본문을 버린 사례로 단정할 수 없었다.
- 기존 8 MiB 공유 예산을 CDN 스크립트가 소진했다. 실제 추적에서 `SOURCE_RESPONSE_TOO_LARGE`와 `SOURCE_BUDGET_EXHAUSTED`를 확인했다. 이후 HTTP fallback도 같은 고갈된 예산을 받아 실패했다.
- HTTP fallback은 `og:description`만 사용했고, 한국어 16진 numeric entity와 URL의 `&#064;`를 디코딩하지 못했다. 전체 연속 글 대신 미리보기만 사용하거나 post identity 검증에 실패할 수 있었다.
- 같은 테스트 계정의 `@aicoffeechat/post/Dcml1kSk3JN`은 수정 전 저장 원문 432자, 요약 329자였다. 수정 후 공개 payload에서는 루트+연속 글 8개, 2,485자를 확보했다. 적어도 이 사례는 프롬프트 강화가 아니라 입력 누락 문제다.
- 최근 `cf0a6e0` 변경에서 요약 편집 프롬프트 자체는 바뀌지 않았다. 이번에도 모델·프롬프트·출력 문장 수를 변경하지 않는다.

## 설계 결정

**문제 →** 브라우저 리소스 소비 때문에 정상 HTML 수집까지 실패하고, 미리보기나 UI 전체 텍스트는 본문 완전성을 보장하지 못한다.

**선택지 →** 용량/글자 수 기준만 완화 / 브라우저 보안 제한 제거 / 공개 HTML의 구조화 게시글 데이터를 우선 읽고 제한된 브라우저를 보조로 사용.

**선택한 방법 →** 마지막 방법. 먼저 2 MiB/10초 범위에서 공개 HTML을 요청한다. `application/json` 안의 `result.data.media` 중 요청 post code/작성자가 일치하는 root를 선택한다. 같은 media ID의 분리 payload에서 `self_thread.posts.edges`를 결합하고 순서를 보존한다. 일반 replies, relatedPosts, quoted posts는 합치지 않는다. 스크립트는 실행하지 않고 JSON만 파싱한다.

**선택 이유 →** 실제 두 페이지가 이 구조로 본문/연속 글을 제공한다. 글 길이에 의존하지 않고 소유권·관계 증거를 사용하며 대형 CDN 스크립트 없이 원문을 수집한다.

**트레이드오프 →** Threads 비공식 공개 페이지 구조 변화에 취약하다. pagination/누락 항목/본문 상한 truncation은 PARTIAL로 표시하고, 증거가 있는 self-thread도 공개되지 않은 내용까지 COMPLETE라고 단정하지 않는다. 비공개 API, 로그인 우회, 저장된 사용자 쿠키를 사용하지 않는다.

## 작업 분리 및 계약

- Backend: `threads-source.ts` 순수 parser·안전한 reason code·entity decoder, extractor HTTP 우선 경로, 실패 로그 및 테스트.
- Frontend: 코드 변경 없음. 기존 부분 요약·실패·재시도 표시와 단일 Markdown 본문을 사용한다.
- API/DB/migration: 변경 없음. `SUCCESS`/`FALLBACK_SUCCESS`/`FAILED`, `UNKNOWN`/`PARTIAL` 계약 유지.
- 상태: 식별된 본문 → 기존 GENERATING/PERSISTING/DONE. 본문 없음 → 기존 EXTRACTION_FAILED. 기존 generation/lease/CAS, 인증/인가, 멱등 키 및 자동 재시도 횟수 유지.
- 네트워크: HTTPS/host allowlist, 공개 DNS 검증·pinning·redirect 검증은 유지. 최초 HTML 2 MiB + 보조 browser 6 MiB, 전체 목표 deadline 45초. 보조 수집이 실패해도 이미 확보한 신원 일치 메타데이터를 버리지 않고 PARTIAL로만 사용.
- 로그: 단계별 안전한 오류 코드, part 수, 본문 길이만 기록. URL query, HTML, API key, cookie, provider 오류 원문을 기록하지 않는다.

## 검증

- 단위/회귀: 짧은 글·긴 글, 5개 항목, 분리 payload ID 결합, 중복 제거, 다른 작성자/루트·댓글·추천 제외, pagination/잘림 PARTIAL, malformed script, numeric entity, 안전한 오류 기록, browser 예산 고갈 시 메타데이터 보존.
- Backend build 통과. 전체 12 suites / 99 tests 통과. 변경 파일 ESLint 통과.
- 실제 원문 수집: 이력서 글 3 parts / 956자, 소프트웨어 역량 글 8 parts / 2,485자. 양쪽 모두 4·5번째 내용과 결론 확인.
- 실제 Luna/API/DB: `.env`의 `gpt-5.6-luna`를 사용하는 실행 API에 테스트 계정으로 인증한 뒤 두 기존 글에 서로 다른 멱등 키로 재요약을 요청했다. 키/토큰 값은 기록하지 않았다. 두 task 모두 1회 시도 후 SUCCEEDED이며 추가 자동 재호출은 없었다.

| 글 | 수집 본문 | 저장 Markdown | 결과 |
| --- | ---: | ---: | --- |
| 이력서 기준 | 956자 / 3 parts | 1,062자 | SUMMARY_DONE, 다섯 항목·마지막 요약 확인 |
| 소프트웨어 역량 | 2,485자 / 8 parts | 1,464자 | SUMMARY_DONE, 다섯 역량·마지막 요약 확인 |

각 글의 `generation === resultGeneration`, `errorCode === null`을 확인했다. 앱 내 실제 로그인된 웹 상세 화면에서도 이력서 글의 1~5번 제목·설명·한 줄 요약 표시를 확인했다. 화면 열기로 테스트 글은 읽음 처리될 수 있다. 기존 다른 계정 글이나 나머지 저장글은 일괄 재요약하지 않았다.

이번 결과는 원문 수집 회귀의 실제 복구 검증이지 모든 글의 요약 품질 보장은 아니다. 이력서 글은 Markdown 제목·서식과 설명 때문에 원문 문자 수보다 결과가 길다. 사용자 선호 밀도는 별도 검토 대상이며 길이를 맞추려고 다시 압축하거나 항목을 삭제하지 않았다.

## 전체 diff 셀프 리뷰

- 프롬프트/모델/summaryMarkdown 내용 후처리, Frontend, API/DB 계약은 변경하지 않았다.
- post code+작성자+media ID+self-thread 연결을 사용하고 임의 댓글을 결합하지 않는다. 수집 예산과 네트워크 보안 검사는 유지한다.
- 문자열 길이를 정상 본문의 근거로 쓰지 않는다. 실제 본문 보존 상한은 여전히 50,000자이며 잘림은 PARTIAL이다.
- 수집 실패가 이전 성공 Markdown을 덮어쓰지 않는 기존 generation/lease 경계를 유지한다.
- 운영 로그는 안전한 분류 코드와 수량만 남긴다. 환경/쿠키/provider 원문을 추가 로깅하지 않는다.
- build가 watch 출력 디렉터리를 갱신하는 동안 로컬 API가 중단되어, 테스트 전 기존 watch를 정상 종료 후 재기동했다. 새 API health와 두 실제 job 성공을 확인했고 서버를 켜 둔다.

## 남은 실패 시나리오

페이지 비공개/삭제/접근 제한, HTML 크기·deadline 초과, JSON 구조 변경, pagination 누락, 원문이 이미지에만 있는 경우는 여전히 부분 수집 또는 실패가 가능하다. 남의 댓글로 내용을 채우거나 오래된 원문을 자동 결합하지 않는다. 임의 항목 개수·요약 길이를 강제하지 않는다.
