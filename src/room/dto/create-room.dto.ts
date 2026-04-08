// backend/src/room/dto/create-room.dto.ts
import { IsString, IsBoolean, IsOptional, Min, Max } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @IsOptional()
  roomName: string;

  @IsBoolean()
  @IsOptional()
  isPrivate: boolean;

  @IsString()
  @IsOptional()
  password: string;

  @IsOptional()
  @Min(2)
  @Max(5)
  maxPlayers: number;
}