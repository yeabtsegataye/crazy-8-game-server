// backend/src/room/dto/join-room.dto.ts
import { IsString, IsOptional } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @IsOptional()
  password: string;
}