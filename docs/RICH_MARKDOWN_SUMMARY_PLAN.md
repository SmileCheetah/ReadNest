# 통합 Rich Markdown 요약 설계

- 상태: 구현 및 검증 중
- 최종 수정: 2026-09-09
- 적용 범위: `readnest-api`, `readnest-mobile`

## 1. 요구사항

- 완성된 상세 요약은 `summaryMeta.summaryMarkdown` 하나만 사용한다.
- 별도의 요약 버전이나 렌더링 분기를 두지 않는다.
- 글마다 원문 길이와 논리 구조가 다르므로 고정 글자 수나 원문 대비 비율로 요약 길이를 제한하지 않는다.
- 번호형 원문은 원래 항목 수, 번호, 순서를 보존한다.
- 짧은 글은 불필요한 제목과 목록을 만들지 않는다.
- 원문에 없는 주장, 조언, 결론, 항목을 생성하지 않는다.
- 모바일에서는 Markdown을 HTML이나 WebView 없이 안전한 React Native 컴포넌트로 렌더링한다.

## 2. 성공 조건

- 새 요약과 재요약 결과가 모두 하나의 Markdown 문서로 저장되고 표시된다.
- Markdown이 없는 기존 데이터는 과거 본문을 완성된 상세 요약처럼 표시하지 않고 요약 생성 상태를 보여준다.
- 생성 또는 검증에 실패하면 성공 상태로 저장하지 않는다.
- 번호형, 주제형, 짧은 글이 각각 원문 구조에 맞게 표현된다.
- 긴 글도 항목별 핵심 논리를 잃지 않으며, 화면에서는 문단 경계로 접고 펼칠 수 있다.

## 3. 단일 데이터 계약

상세 화면의 기준 데이터는 다음 필드다.

```ts
type ApiSummaryMeta = {
  summaryType: string;
  title: string;
  oneLineSummary: string;
  coreSummary: string;
  keyPoints: string[];
  conclusion: string;
  tags: string[];
  readingValue: string;
  caution: string;
  contextStatus: string;
  threadStatus: string;
  confidence: number;
  summaryMarkdown?: string;
};
```

`oneLineSummary`, `keyPoints`, `tags` 등은 목록 미리보기와 보조 메타데이터다. 상세 요약을 대신하는 별도 본문이 아니다.

DB의 기존 `summaryMeta Json?`를 그대로 사용하므로 migration은 필요하지 않다. 기존 `summary` 필드는 API 호환과 목록 미리보기를 위해 유지한다.

## 4. 생성 흐름

1. AI는 Markdown 문자열을 직접 만들지 않고 구조화된 `SummaryDocument`를 반환한다.
2. Backend builder가 구조화 결과를 허용된 Markdown으로 조립한다.
3. validator가 길이, 중복, 위험 문법을 검증한다.
4. 검증된 `summaryMarkdown`이 있을 때만 `SUMMARY_DONE`으로 저장한다.
5. 생성 또는 검증 실패 시 queue 재시도 정책을 적용하고, 최종 실패는 `SUMMARY_FAILED`로 저장한다.

```ts
type SummaryDocument = {
  style: 'numbered' | 'thematic' | 'short';
  coreClaim: string;
  sectionTitle: string;
  items: Array<{
    sourceOrder: number | null;
    title: string;
    description: string;
  }>;
  conclusion: string;
  takeaway: string;
};
```

### 구조 선택

- `numbered`: 원문에 명시적인 번호형 큰 항목이 있을 때만 사용한다. `sourceOrder`에 원래 번호를 저장한다.
- `thematic`: 번호 없는 긴 글을 핵심 주제별로 정리한다. 임의 번호를 생성하지 않는다.
- `short`: 단일 주장이나 짧은 글을 자연스러운 문단으로 정리한다. 항목과 섹션을 강제하지 않는다.

## 5. 길이 정책

- 항목 설명에 고정 글자 수 제한을 두지 않는다.
- 원문 대비 고정 요약 비율을 두지 않는다.
- 모델은 반복과 부수적인 예시를 줄이되, 원문의 항목 수·복잡도·인과관계를 보존하는 데 필요한 만큼 작성한다.
- Backend builder는 문장을 임의로 자르지 않고 형식만 결정한다.
- 저장 안정성을 위한 Markdown 전체 상한과 위험 문법 검증은 유지한다. 이 상한은 요약 스타일을 통제하기 위한 분량 목표가 아니다.

## 6. Frontend 표시 규칙

- 유효한 `summaryMarkdown`이 있으면 문서형 renderer로 전체 내용을 표시한다.
- Markdown이 없으면 `요약이 필요해요`와 `요약 생성` 액션을 표시한다.
- `SUMMARIZING`에서는 완성된 요약처럼 보이는 대체 본문을 표시하지 않는다.
- `SUMMARY_FAILED`에서는 실패 이유와 재시도 액션을 제공한다.
- 매우 긴 문서는 문단 경계에서 접고 `전체 요약 펼치기`를 제공한다.
- 복사와 공유는 저장된 Markdown 전체를 기준으로 한다.

지원 문법:

- h2, h3
- paragraph, bold
- ordered list, unordered list
- blockquote
- soft break, hard break

raw HTML, 이미지, iframe, 표, 코드 실행은 지원하지 않는다. 링크를 지원할 경우 `https://`만 허용한다.

## 7. 상태와 실패 처리

| 상태 | 화면 및 처리 |
| --- | --- |
| `SUMMARIZING` | 진행 상태 표시, 중복 재요약 요청 방지 |
| `SUMMARY_DONE` + Markdown | 통합 Markdown 문서 표시 |
| Markdown 없는 기존 데이터 | 요약 생성 안내와 실행 버튼 |
| `SUMMARY_FAILED` | 안전한 오류 메시지와 재시도 버튼 |
| 일부 원문 누락 | 누락 안내와 원문 추가·재요약 액션 |
| 네트워크 오류 | 현재 화면 유지, 재시도 방법 안내 |

BullMQ 재시도가 남아 있으면 `SUMMARIZING` 상태를 유지한다. 최종 시도까지 실패했을 때만 `SUMMARY_FAILED`로 전환한다.

## 8. 테스트 항목

Backend:

- 번호형 1~10 항목과 3번부터 시작하는 원번호 보존
- 주제형에서 임의 번호 미생성
- 짧은 글에서 불필요한 구조 미생성
- 긴 항목 설명 허용
- 빈 항목과 잘못된 번호 거부
- 위험 Markdown과 전체 상한 초과 거부
- API key 없음, timeout, 429, 5xx 처리
- 재시도 중 상태와 최종 실패 상태

Frontend:

- Markdown 정상 렌더링
- Markdown 없는 데이터의 요약 생성 상태
- heading, bold, 목록, blockquote
- 원래 ordered-list 번호 보존
- 긴 문서 접기와 펼치기
- 복사 성공·실패
- 320px 폭, 200% font scale, TalkBack/VoiceOver

## 9. 설계 결정

문제 → 상세 화면에 여러 요약 형식과 분기가 존재하면 사용자는 같은 글에서 서로 다른 내용과 UI를 보게 되고, 실패한 생성 결과가 과거 형식으로 조용히 대체될 수 있다.

가능한 선택지 → 과거 형식을 계속 병행하거나, 데이터 migration으로 일괄 변환하거나, 하나의 Markdown 계약으로 통일하고 기존 데이터는 필요할 때 재요약한다.

선택한 방법 → `summaryMarkdown` 하나를 완성된 상세 요약의 단일 소스로 사용하고 기존 데이터는 재요약한다.

선택 이유 → 렌더링과 품질 기준이 하나로 단순해지고, 생성 실패가 숨겨지지 않으며, 글의 구조와 길이를 자연스럽게 반영할 수 있다.

트레이드오프 → Markdown이 없는 기존 저장 글은 즉시 상세 요약을 볼 수 없고 한 번 재요약해야 한다. 대신 별도 migration과 두 종류의 상세 화면을 장기간 유지하는 복잡성을 피한다.
