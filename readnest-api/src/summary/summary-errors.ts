export class SummaryGenerationError extends Error {
  constructor(
    message: string,
    readonly code = 'AI_UNAVAILABLE',
    readonly retryable = true,
    readonly retryAfterSeconds = 0,
  ) {
    super(message);
    this.name = 'SummaryGenerationError';
  }
}

export function summaryFailure(error: unknown) {
  if (error instanceof SummaryGenerationError) return error;
  return new SummaryGenerationError(
    '요약을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    'PERSISTENCE_FAILED',
  );
}
