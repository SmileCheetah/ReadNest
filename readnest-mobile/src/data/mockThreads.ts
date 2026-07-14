export type ProcessStatus =
  | "SAVED"
  | "SUMMARIZING"
  | "SUMMARY_DONE"
  | "SUMMARY_FAILED"
  | "CONTEXT_INSUFFICIENT";
export type ReadStatus = "UNREAD" | "READ" | "READ_LATER";

export type SavedThread = {
  id: string;
  title: string;
  summary: string;
  summaryMeta?: {
    summaryType: string;
    oneLineSummary: string;
    coreSummary: string;
    readingValue: string;
    caution: string;
    contextStatus: string;
    threadStatus: string;
    confidence: number;
  };
  keyPoints: string[];
  tags: string[];
  extractionConfidence?: number | null;
  summaryRetryCount?: number;
  lastSummaryError?: string | null;
  savedAt: string;
  savedDateLabel: string;
  source: "Threads";
  originalUrl?: string;
  processStatus: ProcessStatus;
  readStatus: ReadStatus;
  threadPart?: {
    current: number;
    total: number;
  };
};

export const savedThreads: SavedThread[] = [
  {
    id: "thread-1",
    title: "개발자 포트폴리오를 개선하는 방법",
    summary:
      "단순한 기술 나열보다 프로젝트의 '왜'와 해결한 문제를 중심으로 포트폴리오를 구성해야 한다는 내용입니다.",
    keyPoints: [
      "사용한 기술보다 해결한 문제를 먼저 보여주기",
      "협업 경험에서 본인의 기여도를 구체적으로 작성하기",
      "코드 한 줄의 의미를 설명할 수 있는 프로젝트를 고르기",
    ],
    tags: ["개발", "포트폴리오", "취업"],
    savedAt: "10:45 AM",
    savedDateLabel: "오늘",
    source: "Threads",
    processStatus: "SUMMARY_DONE",
    readStatus: "UNREAD",
    threadPart: { current: 1, total: 3 },
  },
  {
    id: "thread-2",
    title: "AI 시대에 공부 루틴을 만드는 법",
    summary:
      "AI를 답안지가 아니라 사고를 확장하는 도구로 사용하고, 매일 작은 기록을 남기는 학습 루틴을 제안합니다.",
    keyPoints: [
      "질문을 먼저 만들고 AI에게 검증받기",
      "공부 내용을 짧은 로그로 매일 남기기",
      "복습 주기를 자동화해 장기 기억으로 연결하기",
    ],
    tags: ["AI", "학습", "루틴"],
    savedAt: "09:12 AM",
    savedDateLabel: "오늘",
    source: "Threads",
    processStatus: "SUMMARIZING",
    readStatus: "READ_LATER",
  },
  {
    id: "thread-3",
    title: "주니어 백엔드 면접 준비 체크리스트",
    summary:
      "면접에서는 프레임워크 암기보다 HTTP, DB, 인증, 트랜잭션 같은 기본기를 실제 프로젝트 경험과 연결해 설명하는 것이 중요합니다.",
    keyPoints: [
      "HTTP 요청 흐름을 직접 그려보기",
      "인덱스와 트랜잭션은 예시와 함께 정리하기",
      "JWT 인증 흐름과 보안 주의점을 말할 수 있게 준비하기",
    ],
    tags: ["백엔드", "면접", "NestJS"],
    savedAt: "어제",
    savedDateLabel: "어제",
    source: "Threads",
    processStatus: "CONTEXT_INSUFFICIENT",
    readStatus: "UNREAD",
    threadPart: { current: 2, total: 4 },
  },
  {
    id: "thread-4",
    title: "생산성 도구의 함정과 본질에 대하여",
    summary:
      "도구를 많이 쓰는 것보다 기록이 다시 행동으로 이어지는 구조를 만드는 것이 생산성의 핵심이라는 글입니다.",
    keyPoints: [
      "도구 선택보다 반복 가능한 시스템이 중요함",
      "기록은 다음 행동을 만들 때 의미가 있음",
      "하루 단위로 작게 정리하는 습관이 유지에 유리함",
    ],
    tags: ["생산성", "기록", "습관"],
    savedAt: "5월 15일",
    savedDateLabel: "지난주",
    source: "Threads",
    processStatus: "SUMMARY_DONE",
    readStatus: "READ",
  },
];
