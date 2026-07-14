import { ReadStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateReadStatusDto {
  @IsEnum(ReadStatus)
  readStatus: ReadStatus;
}
