import { ProcessStatus, ReadStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListArticlesQueryDto {
  @IsOptional()
  @IsIn(['today', 'week', 'last-week', 'month', 'all'])
  period?: 'today' | 'week' | 'last-week' | 'month' | 'all';

  @IsOptional()
  @IsEnum(ProcessStatus)
  processStatus?: ProcessStatus;

  @IsOptional()
  @IsEnum(ReadStatus)
  readStatus?: ReadStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(['cursor'])
  pagination?: 'cursor';

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
