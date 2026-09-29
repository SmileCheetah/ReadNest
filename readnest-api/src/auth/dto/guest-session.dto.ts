import { IsUUID } from 'class-validator';

export class GuestSessionDto {
  @IsUUID('4')
  deviceId!: string;
}
