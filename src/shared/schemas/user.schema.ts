// backend/src/shared/schemas/user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true, lowercase: true })
  username: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true, unique: true, lowercase: true })
  email: string;

  @Prop({ default: 0 })
  gamesPlayed: number;

  @Prop({ default: 0 })
  gamesWon: number;

  @Prop({ default: 0 })
  totalScore: number;

  @Prop({ default: 0 })
  winRate: number;

  @Prop({ default: 1000 })
  eloRating: number;

  @Prop({ default: false })
  isOnline: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Room', default: null }) // Add default: null
  currentRoomId: Types.ObjectId | null;

  @Prop()
  lastActiveAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);