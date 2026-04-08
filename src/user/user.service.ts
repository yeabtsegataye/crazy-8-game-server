// backend/src/user/user.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../shared/schemas/user.schema';
import { Room } from '../shared/schemas/room.schema'; // Import Room

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Room.name) private roomModel: Model<Room>, // Add Room model
  ) {}

  async getUserProfile(userId: string): Promise<any> {
    const user = await this.userModel.findById(userId).select('-password');
    if (!user) {
      throw new Error('User not found');
    }

    // Check if user is in a room
    let currentRoomId = null;
    if (user.currentRoomId) {
      try {
        const room = await this.roomModel.findById(user.currentRoomId);
        if (room) {
          currentRoomId = room._id.toString();
        }
      } catch (error) {
        // Room not found or invalid ID - clear the reference
        console.log(`Room ${user.currentRoomId} not found, clearing reference`);
        user.currentRoomId = null;
        await user.save();
      }
    }

    return {
      id: user._id,
      username: user.username,
      email: user.email,
      gamesPlayed: user.gamesPlayed,
      gamesWon: user.gamesWon,
      winRate: user.winRate,
      eloRating: user.eloRating,
      isOnline: user.isOnline,
      currentRoomId: currentRoomId,
      lastActiveAt: user.lastActiveAt,
    };
  }

  async getUserStats(userId: string): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return {
      gamesPlayed: user.gamesPlayed,
      gamesWon: user.gamesWon,
      winRate: user.winRate,
      eloRating: user.eloRating,
      totalScore: user.totalScore,
      rank: await this.getUserRank(userId),
    };
  }

  async getLeaderboard(): Promise<any[]> {
    const users = await this.userModel
      .find()
      .sort({ eloRating: -1, winRate: -1 })
      .limit(50)
      .select('username eloRating winRate gamesPlayed gamesWon')
      .exec();

    return users.map((user, index) => ({
      rank: index + 1,
      username: user.username,
      eloRating: user.eloRating,
      winRate: user.winRate,
      gamesPlayed: user.gamesPlayed,
      gamesWon: user.gamesWon,
    }));
  }

  private async getUserRank(userId: string): Promise<number> {
    const user = await this.userModel.findById(userId);
    if (!user) return 0;

    const usersWithHigherElo = await this.userModel.countDocuments({
      eloRating: { $gt: user.eloRating },
    });

    return usersWithHigherElo + 1;
  }

  // Optional: Add method to update user's room status
  // async updateUserRoomStatus(userId: string, roomId: string | null): Promise<User> {
  //   const user = await this.userModel.findById(userId);
  //   if (!user) {
  //     throw new Error('User not found');
  //   }

  //   user.currentRoomId = roomId;
  //   await user.save();
    
  //   return user;
  // }
}