// backend/src/room/room.controller.ts
import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  UseGuards, 
  Request 
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RoomService } from './room.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';

@Controller('rooms')
@UseGuards(AuthGuard('jwt'))
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Get()
  async getAllRooms() {
    return this.roomService.getAllRooms();
  }

  @Post('create')
  async createRoom(@Request() req, @Body() createRoomDto: CreateRoomDto) {
    return this.roomService.createRoom(req.user._id, createRoomDto);
  }

  @Post('join/:roomCode')
  async joinRoom(
    @Request() req,
    @Param('roomCode') roomCode: string,
    @Body() joinRoomDto: JoinRoomDto,
  ) {
    return this.roomService.joinRoom(req.user._id, roomCode, joinRoomDto);
  }

  @Post('leave')
  async leaveRoom(@Request() req) {
    return this.roomService.leaveRoom(req.user._id);
  }

  @Get('my-room')
  async getMyRoom(@Request() req) {
    return this.roomService.getUserRoom(req.user._id);
  }
}