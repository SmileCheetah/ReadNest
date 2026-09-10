# Rich Markdown 요약 문제 해결 기록

현재 기준 문서는 [`RICH_MARKDOWN_SUMMARY_PLAN.md`](./RICH_MARKDOWN_SUMMARY_PLAN.md)다.

## 변경 내용

- AI 프롬프트를 `다음 글을 요약해줘.\n\n{원문}` 하나로 단순화했다.
- 구조화 JSON, 유형별 지시, 고정 항목 수와 고정 분량 지시를 제거했다.
- Luna의 자연어 응답을 그대로 `summaryMarkdown`으로 저장한다.
- Backend는 응답의 안전한 Markdown 여부만 검증한다.
- 기존 builder와 구조화 문서 변환 경로를 제거했다.
- 상세 화면은 저장된 Markdown 하나만 표시한다.

## 남은 확인

- 실제 원문별 Luna 요약 품질은 운영 데이터로 지속 확인한다.
- 기존 저장 요약은 자동으로 재작성하지 않으며, 사용자가 재요약할 때 새 프롬프트를 적용한다.
- 실제 Android 기기에서 Markdown 줄바꿈과 접근성을 확인한다.
