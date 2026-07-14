import { ProcessStatus, ReadStatus } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
