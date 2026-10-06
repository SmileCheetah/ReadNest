import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// Exact Unicode-codepoint bounds and normalized nonempty names are also checked
// by the service, after normalization. DTO limits bound transport input early.
export class CreateTopicDto {
  @IsString()
  @MaxLength(240)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  description?: string | null;
}

export class UpdateTopicDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(240)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  description?: string | null;

  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedRevision!: number;
}

export class ListTopicsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

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
