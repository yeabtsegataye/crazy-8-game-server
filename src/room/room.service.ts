// backend/src/room/room.service.ts
import { 
  Injectable, 
  NotFoundException, 
  BadRequestException,
  ForbiddenException 
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Room, RoomStatus } from '../shared/schemas/room.schema';
import { User } from '../shared/schemas/user.schema';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';

@Injectable()
export class RoomService {
  constructor(
    @InjectModel(Room.name) private roomModel: Model<Room>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async getAllRooms(): Promise<Room[]> {
    return this.roomModel
      .find({ status: RoomStatus.WAITING })
      .select('-password')
      .populate('hostId', 'username')
      .exec();
  }

  async createRoom(userId: string, createRoomDto: CreateRoomDto): Promise<Room> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user is already in a room
    if (user.currentRoomId) {
      throw new BadRequestException('You are already in a room');
    }

    // Generate unique room code
    const roomCode = this.generateRoomCode();

    const roomData: any = {
      roomCode,
      roomName: createRoomDto.roomName || `Room ${roomCode}`,
      hostId: new Types.ObjectId(userId),
      maxPlayers: createRoomDto.maxPlayers || 5,
      minPlayers: 2,
      isPrivate: createRoomDto.isPrivate || false,
      players: [{
        userId: new Types.ObjectId(userId),
        username: user.username,
        seatPosition: 0,
        joinedAt: new Date(),
      }],
      currentPlayers: 1,
    };

    if (createRoomDto.isPrivate && createRoomDto.password) {
      roomData.password = await bcrypt.hash(createRoomDto.password, 10);
    }

    const room = await this.roomModel.create(roomData);

    // Update user's current room - Convert string to ObjectId
    user.currentRoomId = new Types.ObjectId(room._id.toString());
    await user.save();

    return room;
  }

  async joinRoom(userId: string, roomCode: string, joinRoomDto: JoinRoomDto): Promise<Room> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.currentRoomId) {
      throw new BadRequestException('You are already in a room');
    }

    const room = await this.roomModel.findOne({ roomCode });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    if (room.status !== RoomStatus.WAITING) {
      throw new BadRequestException('Room is not accepting new players');
    }

    if (room.currentPlayers >= room.maxPlayers) {
      throw new BadRequestException('Room is full');
    }

    // Check password if room is private
    if (room.isPrivate && room.password) {
      const isPasswordValid = await bcrypt.compare(
        joinRoomDto.password || '',
        room.password,
      );
      if (!isPasswordValid) {
        throw new ForbiddenException('Invalid password');
      }
    }

    // Find available seat position
    const takenPositions = room.players.map(p => p.seatPosition);
    let seatPosition = 0;
    while (takenPositions.includes(seatPosition)) {
      seatPosition++;
    }

    // Add player to room
    room.players.push({
      userId: new Types.ObjectId(userId),
      username: user.username,
      seatPosition,
      joinedAt: new Date(),
    });
    room.currentPlayers++;

    await room.save();

    // Update user's current room - Convert string to ObjectId
    user.currentRoomId = new Types.ObjectId(room._id.toString());
    await user.save();

    return room;
  }

  async leaveRoom(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.currentRoomId) {
      return;
    }

    const room = await this.roomModel.findById(user.currentRoomId);
    if (!room) {
      // Clear invalid reference
      user.currentRoomId = null;
      await user.save();
      return;
    }

    // Remove player from room
    room.players = room.players.filter(p => 
      p.userId.toString() !== userId
    );
    room.currentPlayers--;

    // If no players left, delete room
    if (room.currentPlayers === 0) {
      await room.deleteOne();
    } else {
      // If host left, assign new host
      if (room.hostId.toString() === userId) {
        room.hostId = room.players[0].userId;
      }
      await room.save();
    }

    // Update user - set to null (not a string)
    user.currentRoomId = null;
    await user.save();
  }

  async getUserRoom(userId: string): Promise<Room | null> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.currentRoomId) {
      return null;
    }

    return this.roomModel
      .findById(user.currentRoomId)
      .populate('players.userId', 'username')
      .populate('hostId', 'username')
      .exec();
  }

  private generateRoomCode(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }
}