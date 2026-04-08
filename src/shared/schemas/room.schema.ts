// backend/src/shared/schemas/room.schema.ts (updated)
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum RoomStatus {
  WAITING = 'waiting',
  PLAYING = 'playing',
  FINISHED = 'finished',
}

@Schema({ timestamps: true })
export class Room extends Document {
  @Prop({ required: true, unique: true })
  roomCode: string;

  @Prop({ required: true })
  roomName: string;

  @Prop({ 
    type: String, 
    enum: RoomStatus, 
    default: RoomStatus.WAITING 
  })
  status: RoomStatus;

  @Prop({ 
    type: Types.ObjectId, 
    ref: 'User', 
    required: true 
  })
  hostId: Types.ObjectId;

  @Prop({ 
    type: [{ 
      userId: { type: Types.ObjectId, ref: 'User' },
      username: String,
      seatPosition: Number,
      joinedAt: Date
    }],
    default: []
  })
  players: Array<{
    userId: Types.ObjectId;
    username: string;
    seatPosition: number;
    joinedAt: Date;
  }>;

  @Prop({ default: 5 })
  maxPlayers: number;

  @Prop({ default: 2 })
  minPlayers: number;

  @Prop({ default: 0 })
  currentPlayers: number;

  @Prop({ type: Types.ObjectId, ref: 'Game' })
  currentGameId: Types.ObjectId;

  @Prop({ default: false })
  isPrivate: boolean;

  @Prop()
  password?: string;
}

export const RoomSchema = SchemaFactory.createForClass(Room);