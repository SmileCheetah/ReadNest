import { BadRequestException } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const TOPIC_CATEGORIES = [
  '개발',
  'AI·기술',
  '경제·금융',
  '커리어',
  '비즈니스',
  '디자인',
  '생활·문화',
  '과학·사회',
];
export const OSS_CATEGORIES = [
  'AI·에이전트',
  '개발 도구',
  '웹·앱 개발',
  '데이터·인프라',
  '생산성·지식 관리',
  '기타 도구',
];
export const KINDS = ['ARTICLE', 'OPEN_SOURCE', 'UNCLASSIFIED'] as const;
export type ClassificationKind = (typeof KINDS)[number];
export class ClassificationQuery {
  @IsOptional() @IsIn(KINDS) kind?: ClassificationKind;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(100) cursor?: string;
}
export class EditClassification {
  @IsIn(KINDS) kind!: ClassificationKind;
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsString({ each: true })
  categories!: string[];
  @IsInt() @Min(0) revision!: number;
}
export function validateCategories(kind: ClassificationKind, values: string[]) {
  const allowed =
    kind === 'ARTICLE'
      ? TOPIC_CATEGORIES
      : kind === 'OPEN_SOURCE'
        ? OSS_CATEGORIES
        : [];
  if (
    !Array.isArray(values) ||
    values.some((value) => !allowed.includes(value)) ||
    (kind !== 'UNCLASSIFIED' && values.length === 0)
  ) {
    throw new BadRequestException('분류에 맞는 주제를 선택해 주세요.');
  }
  return [...new Set(values)];
}
export const classificationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...KINDS] },
    categories: {
      type: 'array',
      items: { type: 'string', enum: [...TOPIC_CATEGORIES, ...OSS_CATEGORIES] },
    },
    projectName: { type: 'string' },
    useCase: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['kind', 'categories', 'projectName', 'useCase', 'evidence'],
};
export function parseClassification(value: unknown, raw: string) {
  if (!value || typeof value !== 'object')
    throw new Error('INVALID_CLASSIFICATION');
  const data = value as Record<string, unknown>;
  if (
    !KINDS.includes(data.kind as ClassificationKind) ||
    !Array.isArray(data.categories) ||
    data.categories.length > 8 ||
    !data.categories.every((v) => typeof v === 'string')
  )
    throw new Error('INVALID_CLASSIFICATION');
  const kind = data.kind as ClassificationKind;
  const categories = validateCategories(kind, data.categories);
  for (const key of ['projectName', 'useCase', 'evidence'])
    if (typeof data[key] !== 'string')
      throw new Error('INVALID_CLASSIFICATION');
  const projectName = (data.projectName as string).trim();
  const useCase = (data.useCase as string).trim();
  const evidence = (data.evidence as string).trim();
  if (projectName.length > 100 || useCase.length > 300 || evidence.length > 500)
    throw new Error('INVALID_CLASSIFICATION');
  if (kind !== 'UNCLASSIFIED' && (!evidence || !raw.includes(evidence)))
    throw new Error('UNSUPPORTED_CLASSIFICATION');
  if (kind === 'OPEN_SOURCE' && (!projectName || !useCase))
    throw new Error('INVALID_PROJECT');
  if (
    kind === 'OPEN_SOURCE' &&
    !raw
      .normalize('NFKC')
      .toLowerCase()
      .includes(projectName.normalize('NFKC').toLowerCase())
  )
    throw new Error('UNSUPPORTED_PROJECT_NAME');
  return {
    kind,
    categories,
    projectName: kind === 'OPEN_SOURCE' ? projectName : null,
    useCase: kind === 'OPEN_SOURCE' ? useCase : null,
    evidence: evidence || null,
  };
}
