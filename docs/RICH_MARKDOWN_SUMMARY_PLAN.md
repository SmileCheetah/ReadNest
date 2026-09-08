# Rich Markdown 요약 Backend 결정사항

## 계약

기존 요약 필드는 유지하고 `summaryMeta` JSON에 `schemaVersion: 2`와
`summaryMarkdown: string`을 additive 방식으로 추가한다. 기존 앱은 `summary`,
`oneLineSummary`, `coreSummary`, `keyPoints`, `tags`를 계속 사용할 수 있다.

상세 Markdown은 `summary`와 `summaryMeta.summaryMarkdown`에 동일하게 저장하며,
구조화 필드와 Markdown은 한 번의 DB update로 원자적으로 반영한다. DB migration은
필요하지 않다(`summaryMeta`가 Json이기 때문).

## 생성 및 fallback

OpenAI Responses API와 `gpt-5.6-luna`를 유지한다. V2 응답은 schema version과
Markdown 런타임 검증을 모두 통과해야 한다. 누락·빈 값·길이 초과·raw HTML·위험한
링크·중복 문단·지원하지 않는 heading이 있으면 기존 V1 fallback으로 처리한다.

허용 문법은 문단, `##`/`###` heading, bold, ordered/unordered list,
blockquote, 줄바꿈이다. HTML, 이미지, iframe, 표, 코드 펜스와 실행 코드,
외부 링크 자동 활성화는 허용하지 않는다.

## 정합성

AI 호출은 DB transaction 밖에서 실행한다. 결과 저장은 요약 관련 필드와 상태를
한 번에 update한다. 실패 시 기존 V1 응답과 레거시 데이터의 API 호환성을 보장한다.

## 품질 규칙

프롬프트는 원문의 숫자·항목 수·순서를 보존하고, 근거 → 대조되는 사실 → 인과관계
→ 결론 흐름과 양보·대조 논리를 생략하지 않도록 요구한다. bold는 문단마다 최대
1~2개로 제한한다. Python fixture는 생태계·사람과 AI의 사용·성능 대비 인터페이스·
C/C++·CUDA·네트워크 효과 결론을 검증 대상으로 삼는다.

## 구조 적응형 생성 결정 (2026-09-09)

모든 원문에 동일한 `핵심 주장 + 항목 + 결론` 템플릿을 적용하지 않는다. 출력은 짧고 밀도 있게 유지하며 일반적으로 원문 분량의 10~20% 이내를 상한으로 삼는다. 주장형,
번호형, 비교형, 정보형, 짧은 글의 형식에 따라 Markdown 구조를 선택한다. 번호와
heading은 원문에 실제 번호형 항목이 있을 때만 생성하며, 짧은 단일 주장에는
불필요한 heading·목록·결론 섹션을 만들지 않는다. bullet과 blockquote도 논리
압축에 도움이 될 때만 사용한다.

## 구현 메모

- Markdown 최대 저장 길이: 16,000자
- V2 검증 실패는 사용자 오류가 아니라 내부 fallback으로 처리하고 원문/응답 전체를 로그에 남기지 않는다.
- 본 문서는 Backend 구현과 함께 갱신하며, 원격 저장소가 연결된 환경에서 커밋·푸시한다.
