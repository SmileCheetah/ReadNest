# Rich Markdown 요약 문제 해결 기록

## 현재 기준

이 문서는 과거 실험 기록이 현재 설계와 충돌하지 않도록 정리한 이력 문서다. 구현의 단일 기준은 [`RICH_MARKDOWN_SUMMARY_PLAN.md`](./RICH_MARKDOWN_SUMMARY_PLAN.md)다.

2026-09-09부터 완성된 상세 요약은 `summaryMeta.summaryMarkdown` 하나만 사용한다. 별도 버전, 대체 상세 본문, 버전별 renderer는 유지하지 않는다.

## 해결된 항목

- AI가 구조화된 문서를 반환하고 Backend builder가 Markdown을 조립한다.
- HTML, iframe, 이미지, 표, 코드 펜스, 링크와 지원하지 않는 heading을 거부한다.
- 저장 안정성을 위한 전체 16,000자 상한을 유지한다.
- 항목별 글자 수와 원문 대비 요약 비율 제한을 제거했다.
- 문단 반복 횟수와 강조 개수로 정상 요약을 거부하던 내용 기반 제한을 제거했다.
- Markdown 생성 또는 검증 실패를 성공 요약으로 저장하지 않는다.
- OpenAI timeout, 429, 5xx와 API key 누락을 실패로 처리하고 queue 재시도 정책을 적용한다.
- 번호형 원문의 번호와 순서를 보존하는 builder 및 renderer 테스트를 추가했다.
- Markdown이 없는 기존 데이터는 상세 화면에서 요약 생성 대상으로 안내한다.

## 남은 운영 확인

- 실제 모델 호출로 번호형·주제형·짧은 글의 의미 보존 품질을 지속 평가한다.
- 중복 worker와 오래된 결과 덮어쓰기를 막는 generation guard는 별도 DB 계약으로 설계한다.
- 실제 Android 기기에서 320px 폭, 200% 글자 크기, TalkBack을 확인한다.
- 의존성 취약점은 major upgrade 영향 검토 후 별도 작업으로 처리한다.
