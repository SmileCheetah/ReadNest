// One paid, synthetic API call. No real saved article or key is printed.
require('dotenv').config({ quiet: true });
const OpenAI = require('openai');

const source = '데이터 정합성은 금융 서비스에서 중요하다.';
const related = '금융 서비스는 거래 기록이 정확해야 한다.';
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY is unavailable; smoke test skipped.');
  process.exitCode = 2;
} else {
  const client = new OpenAI({ apiKey: key, timeout: 60000, maxRetries: 0 });
  client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-6-luna',
    store: false,
    input: `두 글이 실질적으로 연결되면 한 개만 반환하세요. 각 evidence는 주어진 원문에서 그대로 복사하세요. 연결되지 않으면 빈 배열을 반환하세요. 기준 글: ${source} 후보 글 id=b: ${related}`,
    text: {
      format: {
        type: 'json_schema',
        name: 'connection_smoke',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            links: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  articleId: { type: 'string' },
                  type: { type: 'string', enum: ['SIMILAR', 'COMPLEMENT', 'CONTRAST'] },
                  reason: { type: 'string' },
                  sourceEvidence: { type: 'string' },
                  relatedEvidence: { type: 'string' },
                },
                required: ['articleId', 'type', 'reason', 'sourceEvidence', 'relatedEvidence'],
              },
            },
          },
          required: ['links'],
        },
      },
    },
  }).then((response) => {
    const parsed = JSON.parse(response.output_text);
    const evidenceExact = parsed.links.every((link) =>
      source.includes(link.sourceEvidence) && related.includes(link.relatedEvidence));
    console.log(JSON.stringify({ status: response.status, linkCount: parsed.links.length, evidenceExact }));
    if (response.status !== 'completed' || !evidenceExact) process.exitCode = 1;
  }).catch((error) => {
    console.error(JSON.stringify({ name: error.name, status: error.status, code: error.code }));
    process.exitCode = 1;
  });
}
