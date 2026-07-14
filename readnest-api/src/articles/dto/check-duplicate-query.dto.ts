import { IsUrl } from 'class-validator';

export class CheckDuplicateQueryDto {
  @IsUrl({
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  url: string;
}
