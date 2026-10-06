import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export function normalizeTopicName(input: unknown) {
  if (typeof input !== 'string')
    throw new BadRequestException('주제 이름을 입력해 주세요.');
  const name = input.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (
    !name.replace(/\p{Cf}/gu, '').trim() ||
    Array.from(name).length > 80 ||
    /\p{Cc}/u.test(name)
  )
    throw new BadRequestException(
      '주제 이름은 공백을 제외해 1~80자로 입력해 주세요.',
    );
  const nameKey = createHash('sha256')
    .update(name.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' '))
    .digest('hex');
  return { name, nameKey };
}

export function normalizeTopicDescription(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string')
    throw new BadRequestException('주제 설명은 텍스트로 입력해 주세요.');
  const description = input.normalize('NFC').trim();
  if (Array.from(description).length > 2000)
    throw new BadRequestException('주제 설명은 2,000자 이하로 입력해 주세요.');
  return description || null;
}
