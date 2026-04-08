// backend/src/room/room-recovery.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room } from '../shared/schemas/room.schema';
import { Game } from '../shared/schemas/game.schema';
import { User } from '../shared/schemas/user.schema'; // Add User import

@Injectable()
export class RoomRecoveryService {
  constructor(
    @InjectModel(Room.name) private roomModel: Model<Room>,
    @InjectModel(Game.name) private gameModel: Model<Game>,
    @InjectModel(User.name) private userModel: Model<User>, // Add User model
  ) {}

  async getUserActiveGame(userId: string): Promise<any> {
    try {
      // Find user's current room
      const user = await this.userModel.findById(userId);
      if (!user || !user.currentRoomId) {
        return null;
      }

      // Find the room
      const room = await this.roomModel.findById(user.currentRoomId);
      if (!room || !room.currentGameId) {
        return null;
      }

      // Find the active game
      const game = await this.gameModel.findById(room.currentGameId);
      if (!game || game.status !== 'active') {
        return null;
      }

      // Find player's data
      const player = game.players.find(p => p.userId.toString() === userId);
      if (!player) {
        return null;
      }

      return {
        roomId: room._id,
        gameId: game._id,
        roomCode: room.roomCode,
        gameState: {
          players: game.players.map(p => ({
            userId: p.userId,
            username: p.username,
            cardsCount: p.cardsCount,
            seatPosition: p.seatPosition,
          })),
          topCard: game.topCard,
          currentPlayerIndex: game.currentPlayerIndex,
          currentDirection: game.currentDirection,
          currentSuit: game.currentSuit,
        },
        playerHand: player.hand,
      };
    } catch (error) {
      console.error('Error getting user active game:', error);
      return null;
    }
  }
}