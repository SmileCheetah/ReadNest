import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateArticleDto {
  @IsUrl({
    require_protocol: true,
    protocols: ['https'],
  })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  title?: string;
}
