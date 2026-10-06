export type KnowledgeTopic = {
  id: string;
  name: string;
  description: string | null;
  revision: number;
  articleCount: number;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgePage<T> = { items: T[]; nextCursor: string | null };
export const TOPIC_NAME_LIMIT = 80;
export const TOPIC_DESCRIPTION_LIMIT = 2000;

export function validateTopicInput(name: string, description: string) {
  const normalizedName = name.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalizedName.replace(/\p{Cf}/gu, "").trim())
    return "주제 이름을 입력해 주세요.";
  if (/\p{Cc}/u.test(normalizedName))
    return "주제 이름에 사용할 수 없는 문자가 있어요.";
  if (Array.from(normalizedName).length > TOPIC_NAME_LIMIT)
    return `주제 이름은 ${TOPIC_NAME_LIMIT}자 이내로 입력해 주세요.`;
  if (
    Array.from(description.normalize("NFC").trim()).length >
    TOPIC_DESCRIPTION_LIMIT
  )
    return `설명은 ${TOPIC_DESCRIPTION_LIMIT}자 이내로 입력해 주세요.`;
  return null;
}
