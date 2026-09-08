# Rich Markdown 요약 및 상세 화면 적용 계획

## 문서 상태

- 상태: 사용자 의도 반영 완료, 구현 전
- 대상: `readnest-api` 요약 생성 계약과 `readnest-mobile` 상세 화면
- 핵심 요구: GPT 웹 답변처럼 소제목, 굵은 강조, 목록, 인용문, 문단이 살아 있는 완성형 요약을 모바일에서 읽는다.
- 원칙: 목록 화면용 짧은 구조화 데이터와 상세 화면용 Markdown 본문을 분리한다.

## 1. 요구사항

상세 요약은 다음 표현을 지원한다.

- `##`, `###` 수준의 소제목
- `**굵은 강조**`
- 순서 있는 목록과 순서 없는 목록
- 인용문
- 자연스러운 문단과 줄바꿈
- 필요한 경우 단순한 텍스트 흐름도
- 마지막 한 문장 요약 또는 결론

예상 결과는 다음과 같은 완성형 문서다.

```md
### 🐍 Python은 왜 ‘AI 시대의 영어’가 되었나?

**1. AI 생태계의 중심 언어가 Python이다**

- AI/ML → PyTorch, TensorFlow, Transformers
- 데이터 → Pandas, NumPy, Jupyter
- 백엔드 → Django, Flask, FastAPI

즉, 특정 분야의 전문 언어라기보다 **여러 분야를 연결하는 범용 인터페이스**에 가까워지고 있다.

> **사람 → Python → AI/데이터/자동화**  
> **AI → Python → 계산/분석/도구 실행**

### Python의 진짜 경쟁력: 네트워크 효과

**사용자 증가 → 라이브러리 증가 → 자료 증가 → AI 활용 증가 → 사용자 증가**

### 한 문장으로 압축하면

> **Python은 거대한 생태계와 네트워크 효과 때문에 AI 시대의 사실상 공용어가 되어가고 있다.**
```

## 2. 성공 조건

- 상세 화면에서 Markdown 문법 기호가 그대로 보이지 않는다.
- 제목, 소제목, 본문, 목록, 인용문이 명확한 시각 계층으로 렌더링된다.
- AI가 생성한 문단과 줄바꿈이 사라지지 않는다.
- 전체 요약을 읽을 수 있으며 임의로 첫 3개 항목만 잘라 의미를 훼손하지 않는다.
- 목록 화면에서는 기존 `oneLineSummary`와 `keyPoints`를 계속 사용한다.
- 기존 저장 데이터와 구버전 앱이 깨지지 않는다.
- 지원하지 않는 HTML과 링크 스킴이 실행되지 않는다.
- 복사 시 Markdown 원문을 그대로 복사할 수 있다.

## 3. 설계 결정

### 문제

현재 `coreSummary: string`과 `keyPoints: string[]`는 목록형 카드에는 적합하지만, 사용자가 원하는 자유로운 문서 구조를 표현하기 어렵다. 프론트의 `clean()` 함수는 Markdown 기호를 제거하므로 AI가 만든 강조와 문단 구조도 함께 사라진다.

### 가능한 선택지

1. 기존 필드를 더 잘게 나눈 고정 JSON schema 사용
2. Markdown 문자열만 저장
3. 기존 구조화 필드와 상세용 Markdown을 함께 저장

### 선택한 방법

하이브리드 방식을 사용한다.

- 목록·검색·간단 카드: 기존 `title`, `oneLineSummary`, `keyPoints`, `tags`
- 상세 읽기 화면: 신규 `summaryMarkdown`
- 품질·상태: 기존 `contextStatus`, `threadStatus`, `confidence`, `caution`

### 선택 이유

- 상세 화면에서 GPT 웹과 유사한 자유로운 문서 구조를 표현할 수 있다.
- 목록 화면은 기존 구조화 필드를 활용해 빠르고 일관되게 렌더링할 수 있다.
- 구버전 앱과 API 호환성을 유지할 수 있다.
- Markdown 생성 실패 시 기존 구조화 요약으로 fallback할 수 있다.

### 트레이드오프

- 같은 의미가 구조화 필드와 Markdown에 중복 저장된다.
- 두 표현의 내용이 어긋날 수 있으므로 한 번의 AI 응답에서 함께 생성하고 원자적으로 저장해야 한다.
- Markdown renderer의 허용 문법과 보안 정책을 유지해야 한다.

## 4. API 및 데이터 변경

기존 엔드포인트는 변경하지 않는다.

```ts
type ApiSummaryMetaV2 = {
  schemaVersion: 2;
  title: string;
  oneLineSummary: string;
  keyPoints: string[];
  summaryMarkdown: string;
  tags: string[];
  summaryType: string;
  contextStatus: string;
  threadStatus: string;
  confidence: number;
  caution: string;
};
```

`summaryMarkdown` 제약:

- 권장 분량: 원문의 15~30%
- 최대 저장 길이: 제품 기준 확정 후 서버 검증
- 제목은 `#` 대신 `###`부터 사용하거나 앱의 문서 제목과 중복되지 않게 프롬프트에서 제한
- 원문에 목록이 있으면 개수와 순서를 보존
- 원문에 없는 사실, 조언, 해석을 추가하지 않음
- 동일 내용을 여러 섹션에서 반복하지 않음
- 결론 또는 한 문장 요약 섹션 포함

DB는 기존 `summaryMeta Json?`에 additive field를 추가하므로 초기 migration은 필요하지 않다. `summary` 필드는 V1 fallback을 위해 당분간 유지한다.

## 5. 허용 Markdown 문법

1차 지원:

- paragraph
- heading level 2~3
- bold
- ordered list
- unordered list
- blockquote
- soft break와 hard break
- 일반 텍스트의 화살표·기호

1차 미지원:

- raw HTML
- 이미지
- 표
- 코드 실행
- iframe
- 자동 임베드
- 외부 링크 자동 활성화
- 임의 색상과 인라인 style

링크 지원이 필요해지면 `https://`만 허용하고 `javascript:`, `data:`, 사용자 정의 scheme은 차단한다.

## 6. Backend 작업

1. AI JSON schema에 `schemaVersion`과 `summaryMarkdown` 추가
2. 프롬프트에 원하는 Markdown 구성과 지원 문법을 명시
3. Python 예제를 golden fixture로 추가
4. `summaryMarkdown`의 길이, 빈 값, 지원하지 않는 HTML을 검증
5. Markdown과 `oneLineSummary`, `keyPoints`가 같은 AI 응답에서 생성되게 구성
6. 결과 전체를 `summaryMeta`, `summary`, `keyPoints`, `tags`에 한 번의 DB update로 저장
7. V2 생성 실패 시 기존 V1 구조화 요약으로 fallback
8. schema version과 fallback 발생률을 메트릭으로 기록

### 요약 프롬프트 핵심 규칙

- 원문의 핵심 주장과 논리 흐름을 보존한다.
- 원문의 결론을 뒷받침하는 대조·양보·반론 구조를 제거하지 않는다. 특히 `A라서가 아니라 B 때문이다`, `A에는 한계가 있지만 B 때문에 선택된다` 같은 논리는 독립 문단 또는 핵심 항목으로 남긴다.
- 단순히 등장 빈도가 높은 소재를 나열하지 말고 `근거 → 대조되는 사실 → 인과관계 → 결론`의 연결을 우선 보존한다.
- 원문에 번호형 항목이 있으면 개수와 순서를 보존한다.
- 큰 주제는 `###`, 주요 항목 제목은 `**굵게**` 표시한다.
- 세부 예시는 bullet list로 정리한다.
- 흐름이나 대비가 중요하면 blockquote를 사용한다.
- 한 문단은 모바일에서 읽기 좋은 2~4문장으로 제한한다.
- 굵은 강조는 문단마다 핵심 표현 1~2개 이하로 제한한다.
- emoji는 전체 문서에서 최대 1개이며 소제목 앞에서만 선택적으로 사용한다.
- 원문에 없는 의견이나 실행 제안은 추가하지 않는다.

### 의미 보존 검사

AI 결과를 저장하기 전에 다음 질문을 기준으로 품질을 검사한다.

1. 글쓴이의 최종 주장이 무엇인지 남아 있는가?
2. 그 주장을 뒷받침하는 핵심 근거가 남아 있는가?
3. 결론의 설득력을 만드는 대조나 양보 논리가 누락되지 않았는가?
4. 원문의 숫자, 단계 수, 사례가 핵심 논리에 필요한 경우 보존되었는가?
5. 요약이 원문의 주장을 더 강하게 단정하거나 새로운 해석을 추가하지 않았는가?

Python golden fixture에서는 다음 의미가 반드시 포함되어야 한다.

- Python은 AI·데이터·웹·자동화 등 다양한 분야를 연결한다.
- 사람도 AI도 Python을 도구로 사용한다.
- Python 자체가 가장 빠르거나 완벽해서 성공한 것은 아니다.
- C/C++·CUDA가 고성능 연산의 밑단을 담당하고 Python은 이를 쉽게 활용하는 인터페이스가 된다.
- Python의 최종 경쟁력은 생태계와 네트워크 효과라는 결론이다.

## 7. Frontend 작업

### renderer

- React Native용 Markdown renderer를 도입하거나 허용 문법만 처리하는 renderer를 구현한다.
- Markdown을 WebView 또는 HTML로 변환해 렌더링하지 않는다.
- raw HTML은 무시하거나 일반 텍스트로 처리한다.
- 각 Markdown node를 React Native `Text`와 `View`로 렌더링한다.

### 타이포그래피

- `h2/h3`: 20~22px, weight 700, line-height 28~31px
- 항목 제목 bold: 16~17px, weight 700
- 본문: 16px, line-height 26~28px
- 목록 bullet와 번호: 브랜드 파란색 또는 중립색
- blockquote: 약한 배경 또는 짧은 좌측 accent 중 하나만 사용
- 문단 간격: 14~18px
- 큰 섹션 간격: 28~36px
- Markdown 요소 전체를 하나의 카드 안에 중첩하지 않고 읽기 폭을 충분히 확보

### 화면 정책

- 첫 화면의 `핵심 한 줄 요약 + 3개 포인트` 카드는 제거하거나 축소한다.
- `AI 요약` 헤더 아래에서 `summaryMarkdown` 전체를 문서처럼 표시한다.
- 요약이 매우 길면 처음 몇 문단만 보이고 `전체 요약 펼치기`를 제공할 수 있지만, 번호 항목을 임의로 3개에서 자르지 않는다.
- 목록 화면과 홈 카드에서는 기존 `oneLineSummary`만 사용한다.
- `summaryMarkdown`이 없으면 기존 V1 화면으로 fallback한다.
- 현재 `clean()`으로 Markdown을 제거하는 경로는 V2 renderer에서 사용하지 않는다.

## 8. 상태 변화

```text
SUMMARIZING
  ├─ V2 생성 성공 → SUMMARY_DONE + summaryMarkdown 저장
  ├─ V2 검증 실패 → V1 fallback 성공 → SUMMARY_DONE
  └─ AI/추출 실패 → SUMMARY_FAILED 또는 CONTEXT_INSUFFICIENT
```

외부 AI 호출은 DB transaction 밖에서 수행한다. 생성 완료 후 현재 summary generation과 job generation이 일치할 때만 결과를 저장하여 오래된 worker가 최신 결과를 덮어쓰지 않게 한다.

## 9. 실패 시나리오

| 상황 | 처리 |
| --- | --- |
| `summaryMarkdown` 누락 | V1 구조화 요약 렌더링 |
| Markdown 문법 오류 | 가능한 노드는 렌더링하고 나머지는 일반 텍스트 처리 |
| raw HTML 포함 | 제거 또는 escape |
| 지나치게 긴 요약 | 서버 길이 제한과 프론트 펼치기 적용 |
| 굵은 표시 과다 | 프롬프트 제한 및 샘플 기반 평가 |
| 목록 번호 누락·중복 | AI 결과 검증 또는 V1 fallback |
| Markdown renderer crash | Error boundary 또는 V1 fallback |
| 구버전 앱 | 기존 `summary`, `oneLineSummary`, `keyPoints` 사용 |
| 복사 실패 | 오류 안내와 재시도 제공 |
| 외부 AI timeout·429·5xx | queue retry와 상태 표시 |

## 10. 테스트 항목

### Backend

- Python 3-part 원문 golden fixture
- 소제목, bold, bullet, blockquote 생성 여부
- 원문 번호와 항목 개수 보존
- raw HTML과 지원하지 않는 링크 검증
- 지나치게 긴 Markdown 제한
- V2 실패 시 V1 fallback
- 동일 응답의 구조화 필드와 Markdown 내용 일관성
- 기존 데이터와 구버전 API 회귀 테스트

### Frontend

- heading, paragraph, bold, ordered/unordered list, blockquote 렌더링
- 연속 문단과 hard break
- 한글·영문·C/C++·CUDA 같은 혼합 텍스트
- 320px 폭과 200% font scale
- TalkBack/VoiceOver 읽기 순서
- 잘못된 Markdown과 raw HTML
- V2 없음 → V1 fallback
- 긴 요약 펼치기와 스크롤
- 복사 결과가 원본 Markdown과 일치하는지 확인

## 11. 작업 순서

### Phase 1 — 샘플과 계약 확정

1. 사용자가 제공한 Python 원문을 테스트 fixture로 저장
2. 기대 `summaryMarkdown`을 golden output으로 확정
3. 허용 Markdown 문법과 최대 분량 확정

### Phase 2 — Backend 생성

1. schema와 prompt 수정
2. normalize와 fallback 구현
3. Backend 테스트
4. 실제 AI 출력 샘플 비교

### Phase 3 — Frontend 렌더링

1. Markdown renderer 선택 및 보안 검토
2. Unwind 타이포그래피 매핑
3. V1/V2 fallback
4. 실제 Android/iOS QA

### Phase 4 — 점진 배포

- 신규 저장 글과 재요약 글부터 V2 적용
- 기존 글은 일괄 재요약하지 않음
- V2 생성 성공률, fallback 비율, 평균 요약 길이를 확인한 뒤 확대

## 12. 완료 조건

- 제공된 Python 원문이 사용자가 제시한 예시 수준의 완성형 Markdown 요약으로 생성된다.
- 앱에서 문법 기호가 아닌 실제 제목·강조·목록·인용문으로 보인다.
- 목록용 짧은 요약과 상세용 긴 요약의 책임이 분리된다.
- 원문의 항목과 논리 구조가 보존된다.
- V1 데이터와 구버전 앱이 정상 동작한다.
- 지원하지 않는 HTML과 위험 링크가 실행되지 않는다.
- Backend fixture와 Frontend fixture가 동일한 API 계약을 사용한다.

## 13. Mobile Phase 1 결정사항

- React Native Markdown 라이브러리는 추가하지 않고, 계약에 정의된 subset을 직접 React Native 컴포넌트로 렌더링한다.
- renderer는 `##`/`###` heading, paragraph, `**bold**`, ordered/unordered list, blockquote와 soft/hard break만 지원한다.
- raw HTML, 이미지, iframe, 표, 코드 펜스, 자동 링크와 임의 style은 렌더링하지 않는다.
- `schemaVersion === 2`이고 `summaryMarkdown`이 비어 있지 않은 문자열일 때만 V2 renderer를 사용한다. 그 외에는 V1 필드와 레거시 `summary`로 fallback한다.
- 상세 화면은 `summaryMarkdown` 전체를 표시하되 긴 문서는 문단 경계에서 접는다. 목록 화면과 홈 카드는 기존 `oneLineSummary`를 유지한다.
- 복사는 V2 Markdown 전체와 원문 URL을 포함하고, V1은 기존 일반 텍스트 형식을 유지한다.

## Ordered list 렌더링 결정

- ordered list parser는 `marker`와 항목 텍스트를 함께 보존하며 renderer가 `itemIndex + 1`로 번호를 재생성하지 않는다.
- 빈 줄로 분리된 목록도 각 항목의 원래 번호를 유지한다. 따라서 `2.`, `3.`으로 시작하는 입력은 화면에서도 동일한 번호를 사용한다.
- 정확히 `숫자. **짧은 제목**`만 단독으로 있는 legacy line은 목록이 아닌 h3로 표시한다. 그 외 ordered list는 일반 목록으로 보존한다.
- V2 상세 문서는 V1 요약 카드와 분리해 카드 배경 없이 문서 흐름으로 표시한다. V1 데이터는 기존 카드와 fallback을 유지한다.
