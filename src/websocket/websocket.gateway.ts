// backend/src/websocket/websocket.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from '../game/game.service';
import { RoomService } from '../room/room.service';
import { JwtService } from '@nestjs/jwt';

interface ConnectedUser {
  socketId: string;
  userId: string;
  username: string;
  roomId?: string;
}

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  },
  namespace: '/game',
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers: Map<string, ConnectedUser> = new Map();
  private userRooms: Map<string, string> = new Map(); // userId -> roomId
  private socketUsers: Map<string, string> = new Map(); // socketId -> userId
  private turnTimers: Map<string, NodeJS.Timeout> = new Map(); // gameId -> timer
  private turnEndsAt: Map<string, number> = new Map(); // gameId -> epoch ms
  private rematchVotes: Map<string, Set<string>> = new Map(); // roomId -> userIds

  constructor(
    private readonly gameService: GameService,
    private readonly roomService: RoomService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    console.log(`Client connecting: ${client.id}`);
    
    try {
      const token = client.handshake.auth.token;
      if (!token) {
        console.log('No token provided');
        client.disconnect();
        return;
      }

      // Verify JWT token
      let payload: any;
      try {
        payload = this.jwtService.verify(token);
      } catch (error) {
        console.log('Invalid token:', error.message);
        client.disconnect();
        return;
      }

      const userId = payload.userId || payload.sub;
      const username = payload.username;

      if (!userId || !username) {
        console.log('Missing user info in token');
        client.disconnect();
        return;
      }

      // Store user connections
      this.connectedUsers.set(client.id, {
        socketId: client.id,
        userId,
        username,
      });
      
      this.socketUsers.set(client.id, userId);

      // Get user's current room
      try {
        const userRoom = await this.roomService.getUserRoom(userId);
        if (userRoom) {
          this.userRooms.set(userId, userRoom._id.toString());
          client.join(userRoom._id.toString());
          console.log(`User ${username} joined room ${userRoom._id}`);
          
          // Notify room that user reconnected
          this.server.to(userRoom._id.toString()).emit('player-reconnected', {
            userId,
            username,
          });
        }
      } catch (error) {
        console.log('User not in a room:', error.message);
      }

      console.log(`Client connected: ${client.id} (${username})`);
    } catch (error) {
      console.error('Connection error:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = this.connectedUsers.get(client.id);
    if (user) {
      console.log(`Client disconnected: ${client.id} (${user.username})`);
      this.connectedUsers.delete(client.id);
      this.socketUsers.delete(client.id);
      
      // If user was in a room, notify others
      const roomId = this.userRooms.get(user.userId);
      if (roomId) {
        this.server.to(roomId).emit('player-disconnected', {
          userId: user.userId,
          username: user.username,
        });
        this.userRooms.delete(user.userId);
      }
    }
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    console.log(`User ${user.username} joining room ${data.roomId}`);
    
    // Leave previous room if any
    const previousRoomId = this.userRooms.get(user.userId);
    if (previousRoomId && previousRoomId !== data.roomId) {
      client.leave(previousRoomId);
      this.server.to(previousRoomId).emit('player-left', {
        userId: user.userId,
        username: user.username,
      });
    }

    // Join new room
    client.join(data.roomId);
    this.userRooms.set(user.userId, data.roomId);
    
    // Notify room
    this.server.to(data.roomId).emit('player-joined', {
      userId: user.userId,
      username: user.username,
    });

    return { success: true, roomId: data.roomId };
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    console.log(`User ${user.username} leaving room ${data.roomId}`);
    
    client.leave(data.roomId);
    this.userRooms.delete(user.userId);
    
    this.server.to(data.roomId).emit('player-left', {
      userId: user.userId,
      username: user.username,
    });

    return { success: true };
  }

  @SubscribeMessage('start-game')
  async handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    console.log(`Starting game for room ${data.roomId}`);
    
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    try {
      // Create the game
      const game = await this.gameService.createGame(data.roomId, user.userId);
      
      console.log(`Game created: ${game._id}`);
      console.log('Players:', game.players.map(p => p.username));
      console.log('Top card:', game.topCard);

      // Send game data to ALL players in the room
      const gameData = {
        gameId: game._id.toString(),
        players: game.players.map(p => ({
          userId: p.userId.toString(),
          username: p.username,
          seatPosition: p.seatPosition,
          cardsCount: p.cardsCount,
          isActive: p.isActive,
          hasPressedCrazyButton: p.hasPressedCrazyButton,
          penaltiesToDraw: p.penaltiesToDraw,
        })),
        topCard: game.topCard,
        currentPlayerIndex: game.currentPlayerIndex,
        currentDirection: game.currentDirection,
        currentSuit: game.currentSuit,
        drawPenaltyStack: game.drawPenaltyStack,
        isCrazyModeActive: game.isCrazyModeActive,
      };

      console.log('Emitting game-started event to room:', data.roomId);
      
      // Emit to ALL players in the room - THIS IS CRITICAL
      this.server.to(data.roomId).emit('game-started', gameData);
      
      // Don't allow adapter introspection to crash start-game
      try {
        console.log(`Sent game-started to ${this.getRoomSocketsCount(data.roomId)} sockets in room ${data.roomId}`);
      } catch (e: any) {
        console.warn('[WebsocketGateway] Could not count room sockets:', e?.message || e);
      }

      // Start 30s turn timer
      this.resetTurnTimer(game._id.toString(), data.roomId);
      this.emitTurnTimer(game._id.toString(), data.roomId, game.currentPlayerIndex);
      await this.autoResolvePenaltyChain(game._id.toString(), data.roomId);

      // Also send individual hand data to each player
      for (const player of game.players) {
        const playerSocket = this.findSocketByUserId(player.userId.toString());
        if (playerSocket) {
          console.log(`Sending hand to player ${player.username}`);
          playerSocket.emit('your-hand', {
            gameId: game._id.toString(),
            hand: player.hand,
            currentPlayerIndex: game.currentPlayerIndex,
            isMyTurn: game.currentPlayerIndex === game.players.findIndex(p => p.userId.toString() === player.userId.toString()),
            hasDrawnThisTurn: player.hasDrawnThisTurn,
          });
        } else {
          console.log(`Could not find socket for player ${player.username}`);
        }
      }

      return { 
        success: true, 
        gameId: game._id.toString(),
        message: 'Game started successfully'
      };
    } catch (error: any) {
      console.error('Error starting game:', error);
      console.error('Stack trace:', error.stack);
      
      // Send error to the client who tried to start the game
      client.emit('game-start-error', {
        error: error.message || 'Failed to start game'
      });
      
      return { error: error.message };
    }
  }

  @SubscribeMessage('chat-message')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; message: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    const roomId = data.roomId;
    const message = (data.message ?? '').toString().trim();
    if (!roomId || !message) {
      return { error: 'Invalid message' };
    }

    // Broadcast to everyone in the room (including sender)
    this.server.to(roomId).emit('chat-message', {
      roomId,
      userId: user.userId,
      username: user.username,
      message,
      timestamp: new Date().toISOString(),
    });

    // returning a value here supports ack if client uses a callback
    return { success: true };
  }

  @SubscribeMessage('play-card')
  async handlePlayCard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      roomId: string;
      gameId: string;
      cardId: string;
      selectedSuit?: string;
    },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    try {
      const result = await this.gameService.playCard(
        data.gameId,
        user.userId,
        data.cardId,
        data.selectedSuit,
      );

      // Emit to ALL players in the room
      this.server.to(data.roomId).emit('card-played', {
        playerId: user.userId,
        username: user.username,
        cardId: data.cardId,
        newTopCard: result.topCard,
        nextPlayerIndex: result.nextPlayerIndex,
        drawPenaltyStack: result.drawPenaltyStack,
        isCrazyModeActive: result.isCrazyModeActive,
        selectedSuit: result.selectedSuit,
        players: result.players.map(p => ({
          userId: p.userId.toString(),
          username: p.username,
          cardsCount: p.cardsCount,
          penaltiesToDraw: p.penaltiesToDraw,
          hasPressedCrazyButton: p.hasPressedCrazyButton,
        })),
      });

      this.resetTurnTimer(data.gameId, data.roomId);
      this.emitTurnTimer(data.gameId, data.roomId, result.nextPlayerIndex);
      // Turn flow is player-driven (draw once / play / skip); no auto-draw here.
      await this.autoResolvePenaltyChain(data.gameId, data.roomId);

      // Check for win
      if (result.winner) {
        this.server.to(data.roomId).emit('game-ended', {
          winner: {
            userId: result.winner.userId.toString(),
            username: result.winner.username,
          },
          players: result.players.map(p => ({
            userId: p.userId.toString(),
            username: p.username,
            cardsCount: p.cardsCount,
          })),
        });
      }

      return { success: true, result };
    } catch (error: any) {
      // If the current player has a pending penalty stack, they are not allowed to play
      // non-stack cards. Users may still click quickly before the server auto-draws;
      // treat that as a no-op and force-resolve the penalty instead of surfacing errors.
      const message = error?.message || '';
      if (
        typeof message === 'string' &&
        message.includes('You must stack with a 2 or A♠')
      ) {
        try {
          await this.autoResolvePenaltyChain(data.gameId, data.roomId);
          return { success: true, ignored: 'penalty_pending' };
        } catch (e: any) {
          console.error('Error auto-resolving penalty after invalid click:', e);
          // Fall through to original error behavior
        }
      }

      console.error('Error playing card:', error);
      client.emit('play-card-error', { error: error.message });
      return { error: error.message };
    }
  }

  @SubscribeMessage('draw-card')
  async handleDrawCard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; gameId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    try {
      const result = await this.gameService.drawCard(
        data.gameId,
        user.userId,
      );

      // Notify the player about their drawn cards
      client.emit('card-drawn', {
        playerId: user.userId,
        cardsDrawn: result.cardsDrawn,
        canPlayDrawnCard: result.canPlayDrawnCard,
        nextPlayerIndex: result.nextPlayerIndex,
      });

      // Notify other players
      this.server.to(data.roomId).except(client.id).emit('player-drew-card', {
        playerId: user.userId,
        username: user.username,
        cardsCount: result.cardsDrawn.length,
        nextPlayerIndex: result.nextPlayerIndex,
      });

      // If the turn advanced, reset timer
      if (!result.canPlayDrawnCard && result.nextPlayerIndex !== undefined) {
        this.resetTurnTimer(data.gameId, data.roomId);
        this.emitTurnTimer(data.gameId, data.roomId, result.nextPlayerIndex);
        await this.autoResolvePenaltyChain(data.gameId, data.roomId);
      }
      // Turn flow is player-driven (draw once / play / skip); no auto-draw here.

      return { success: true };
    } catch (error: any) {
      console.error('Error drawing card:', error);
      client.emit('draw-card-error', { error: error.message });
      return { error: error.message };
    }
  }

  @SubscribeMessage('press-crazy-button')
  async handlePressCrazyButton(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; gameId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    try {
      const result = await this.gameService.pressCrazyButton(
        data.gameId,
        user.userId,
      );

      // Notify all players
      this.server.to(data.roomId).emit('crazy-button-pressed', {
        playerId: user.userId,
        username: user.username,
        players: result.players.map(p => ({
          userId: p.userId.toString(),
          username: p.username,
          hasPressedCrazyButton: p.hasPressedCrazyButton,
          penaltiesToDraw: p.penaltiesToDraw,
        })),
        isCrazyModeActive: result.isCrazyModeActive,
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error pressing crazy button:', error);
      client.emit('crazy-button-error', { error: error.message });
      return { error: error.message };
    }
  }

  @SubscribeMessage('skip-turn')
  async handleSkipTurn(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; gameId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    try {
      const result = await this.gameService.skipTurn(
        data.gameId,
        user.userId,
      );

      // Notify all players
      this.server.to(data.roomId).emit('turn-skipped', {
        playerId: user.userId,
        username: user.username,
        nextPlayerIndex: result.nextPlayerIndex,
        cardsDrawn: result.cardsDrawn,
      });

      this.resetTurnTimer(data.gameId, data.roomId);
      this.emitTurnTimer(data.gameId, data.roomId, result.nextPlayerIndex);
      // Turn flow is player-driven (draw once / play / skip); no auto-draw here.
      await this.autoResolvePenaltyChain(data.gameId, data.roomId);

      return { success: true };
    } catch (error: any) {
      console.error('Error skipping turn:', error);
      client.emit('skip-turn-error', { error: error.message });
      return { error: error.message };
    }
  }

  @SubscribeMessage('get-current-game')
  async handleGetCurrentGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      return { error: 'Not authenticated' };
    }

    try {
      const room = await this.roomService.getUserRoom(user.userId);
      if (!room || !room.currentGameId) {
        return { error: 'No active game found' };
      }

      const game = await this.gameService.getGameById(room.currentGameId.toString());
      
      // Send game state to the requesting client
      client.emit('current-game-state', {
        gameId: game._id.toString(),
        players: game.players.map(p => ({
          userId: p.userId.toString(),
          username: p.username,
          cardsCount: p.cardsCount,
          seatPosition: p.seatPosition,
          penaltiesToDraw: p.penaltiesToDraw,
        })),
        topCard: game.topCard,
        currentPlayerIndex: game.currentPlayerIndex,
        currentDirection: game.currentDirection,
        currentSuit: game.currentSuit,
        status: game.status,
      });

      // Also send hand if it's this player
      const player = game.players.find(p => p.userId.toString() === user.userId);
      if (player) {
        client.emit('your-hand', {
          gameId: game._id.toString(),
          hand: player.hand,
          currentPlayerIndex: game.currentPlayerIndex,
          isMyTurn:
            game.currentPlayerIndex ===
            game.players.findIndex(p => p.userId.toString() === user.userId),
          hasDrawnThisTurn: player.hasDrawnThisTurn,
        });
      }

      return { success: true, gameId: game._id.toString() };
    } catch (error: any) {
      console.error('Error getting current game:', error);
      return { error: error.message };
    }
  }

  @SubscribeMessage('vote-rematch')
  async handleVoteRematch(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) return { error: 'Not authenticated' };

    const roomId = data.roomId;
    if (!roomId) return { error: 'Missing roomId' };

    const room = await this.roomService.getUserRoom(user.userId);
    if (!room) return { error: 'Room not found' };

    const set = this.rematchVotes.get(roomId) ?? new Set<string>();
    set.add(user.userId);
    this.rematchVotes.set(roomId, set);

    this.server.to(roomId).emit('rematch-votes', {
      roomId,
      votes: Array.from(set),
      required: room.players.length,
    });

    if (set.size >= room.players.length) {
      // everyone agreed -> start new game, keep same room
      this.rematchVotes.delete(roomId);
      const game = await this.gameService.createGame(roomId, room.hostId.toString());

      const gameData = {
        gameId: game._id.toString(),
        players: game.players.map(p => ({
          userId: p.userId.toString(),
          username: p.username,
          seatPosition: p.seatPosition,
          cardsCount: p.cardsCount,
          isActive: p.isActive,
          hasPressedCrazyButton: p.hasPressedCrazyButton,
          penaltiesToDraw: p.penaltiesToDraw,
        })),
        topCard: game.topCard,
        currentPlayerIndex: game.currentPlayerIndex,
        currentDirection: game.currentDirection,
        currentSuit: game.currentSuit,
        drawPenaltyStack: game.drawPenaltyStack,
        isCrazyModeActive: game.isCrazyModeActive,
      };

      this.server.to(roomId).emit('game-started', gameData);
      this.resetTurnTimer(game._id.toString(), roomId);
      this.emitTurnTimer(game._id.toString(), roomId, game.currentPlayerIndex);
      await this.autoResolvePenaltyChain(game._id.toString(), roomId);

      // Send hands
      for (const player of game.players) {
        const playerSocket = this.findSocketByUserId(player.userId.toString());
        if (playerSocket) {
          playerSocket.emit('your-hand', {
            gameId: game._id.toString(),
            hand: player.hand,
            currentPlayerIndex: game.currentPlayerIndex,
            isMyTurn:
              game.currentPlayerIndex ===
              game.players.findIndex(p => p.userId.toString() === player.userId.toString()),
            hasDrawnThisTurn: player.hasDrawnThisTurn,
          });
        }
      }
    }

    return { success: true };
  }

  private findSocketByUserId(userId: string): Socket | null {
    // First find socketId from our mapping
    const socketId = Array.from(this.socketUsers.entries())
      .find(([sId, uId]) => uId === userId)?.[0];
    
    if (socketId) {
      // In a namespaced gateway, sockets may live under this namespace instance
      const anyServer: any = this.server as any;
      return anyServer.sockets?.get?.(socketId) || anyServer.sockets?.sockets?.get?.(socketId) || null;
    }
    
    // Fallback: search through connectedUsers
    for (const [socketId, user] of this.connectedUsers.entries()) {
      if (user.userId === userId) {
        const anyServer: any = this.server as any;
        return anyServer.sockets?.get?.(socketId) || anyServer.sockets?.sockets?.get?.(socketId) || null;
      }
    }
    return null;
  }

  private getRoomSocketsCount(roomId: string): number {
    // Depending on Socket.IO + NestJS namespace wiring, adapter can be on server or on server.sockets
    const anyServer: any = this.server as any;
    const roomsMap =
      anyServer.adapter?.rooms ||
      anyServer.sockets?.adapter?.rooms ||
      anyServer.sockets?.adapter?.rooms;
    if (!roomsMap?.get) return 0;
    const room = roomsMap.get(roomId);
    return room ? room.size : 0;
  }

  private resetTurnTimer(gameId: string, roomId: string) {
    const existing = this.turnTimers.get(gameId);
    if (existing) {
      clearTimeout(existing);
    }

    const endsAt = Date.now() + 30_000;
    this.turnEndsAt.set(gameId, endsAt);

    const timer = setTimeout(async () => {
      try {
        const result = await this.gameService.advanceTurnDueToTimeout(gameId);
        if (!result) return;

        this.server.to(roomId).emit('turn-skipped', {
          playerId: result.timedOutPlayerId,
          username: result.timedOutUsername,
          nextPlayerIndex: result.nextPlayerIndex,
          reason: 'timeout',
        });
        this.emitTurnTimer(gameId, roomId, result.nextPlayerIndex);

        // schedule the next turn
        this.resetTurnTimer(gameId, roomId);
        // Turn flow is player-driven; no auto-draw here.
        await this.autoResolvePenaltyChain(gameId, roomId);
      } catch (e: any) {
        console.error('[TurnTimer] Failed to advance turn:', e?.message || e);
      }
    }, 30_000);

    this.turnTimers.set(gameId, timer);
  }

  private emitTurnTimer(gameId: string, roomId: string, currentPlayerIndex: number) {
    const endsAt = this.turnEndsAt.get(gameId) ?? Date.now() + 30_000;
    this.server.to(roomId).emit('turn-timer', {
      gameId,
      roomId,
      endsAt,
      currentPlayerIndex,
      durationMs: 30_000,
    });
  }

  private async autoResolvePenaltyChain(gameId: string, roomId: string) {
    // Prevent infinite loops; at most one full table rotation
    for (let i = 0; i < 10; i++) {
      const res = await this.gameService.autoResolvePenaltyIfNeeded(gameId);
      if (!res) return;

      // Notify penalized player with actual cards
      const playerSocket = this.findSocketByUserId(res.playerId);
      if (playerSocket) {
        playerSocket.emit('card-drawn', {
          playerId: res.playerId,
          cardsDrawn: res.cardsDrawn,
          canPlayDrawnCard: false,
          nextPlayerIndex: res.nextPlayerIndex,
          reason: 'penalty-auto',
        });
      }

      // Notify everyone else that they drew cards and turn advanced
      this.server.to(roomId).emit('player-drew-card', {
        playerId: res.playerId,
        username: res.username,
        cardsCount: res.cardsDrawn.length,
        nextPlayerIndex: res.nextPlayerIndex,
        reason: 'penalty-auto',
      });

      // Move timer to the new current player
      this.resetTurnTimer(gameId, roomId);
      this.emitTurnTimer(gameId, roomId, res.nextPlayerIndex);
    }
  }
}