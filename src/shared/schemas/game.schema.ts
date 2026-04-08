// backend/src/shared/schemas/game.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum GameStatus {
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  FINISHED = 'finished',
}

export enum GameDirection {
  CLOCKWISE = 'clockwise',
  COUNTER_CLOCKWISE = 'counter_clockwise',
}

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
  value: number;
  id: string;
}

export interface PlayerState {
  userId: Types.ObjectId;
  username: string;
  seatPosition: number;
  hand: Card[];
  cardsCount: number;
  hasPressedCrazyButton: boolean;
  isActive: boolean;
  isWinner: boolean;
  score: number;
  penaltiesToDraw: number;
  hasDrawnThisTurn: boolean;
}

@Schema({ timestamps: true })
export class Game extends Document {
  @Prop({ 
    type: String, 
    enum: GameStatus, 
    default: GameStatus.INITIALIZING 
  })
  status: GameStatus;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Room' })
  roomId: Types.ObjectId;

  @Prop({
    type: [{
      userId: { type: Types.ObjectId, ref: 'User' },
      username: String,
      seatPosition: Number,
      hand: [{ 
        suit: String, 
        rank: String, 
        value: Number, 
        id: String 
      }],
      cardsCount: Number,
      hasPressedCrazyButton: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
      isWinner: { type: Boolean, default: false },
      score: { type: Number, default: 0 },
      penaltiesToDraw: { type: Number, default: 0 },
      hasDrawnThisTurn: { type: Boolean, default: false },
    }]
  })
  players: PlayerState[];

  @Prop({ 
    type: String, 
    enum: GameDirection, 
    default: GameDirection.CLOCKWISE 
  })
  currentDirection: GameDirection;

  @Prop({ type: Number, default: 0 })
  currentPlayerIndex: number;

  @Prop()
  currentSuit: string;

  @Prop({ 
    type: { 
      suit: String, 
      rank: String, 
      value: Number, 
      id: String 
    } 
  })
  topCard: Card;

  @Prop({ type: [{ suit: String, rank: String, value: Number, id: String }] })
  drawPile: Card[];

  @Prop({ type: [{ suit: String, rank: String, value: Number, id: String }] })
  discardPile: Card[];

  @Prop({ type: Number, default: 0 })
  drawPenaltyStack: number;

  @Prop({ type: Boolean, default: false })
  isCrazyModeActive: boolean;

  @Prop({ type: String })
  selectedSuit: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  winnerId: Types.ObjectId;

  @Prop({ type: Date })
  finishedAt: Date;
}

export const GameSchema = SchemaFactory.createForClass(Game);