// backend/src/game/game.service.ts
import { 
  Injectable, 
  NotFoundException, 
  BadRequestException,
  ForbiddenException 
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Game, GameStatus, GameDirection, Card, PlayerState } from '../shared/schemas/game.schema';
import { Room, RoomStatus } from '../shared/schemas/room.schema';
import { User } from '../shared/schemas/user.schema';

@Injectable()
export class GameService {
  private readonly SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  private readonly RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  private readonly VALUES: { [key: string]: number } = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };

  constructor(
    @InjectModel(Game.name) private gameModel: Model<Game>,
    @InjectModel(Room.name) private roomModel: Model<Room>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

async createGame(roomId: string, hostId: string): Promise<Game> {
  console.log(`[GameService] Creating game for room ${roomId} by host ${hostId}`);
  
  const room = await this.roomModel.findById(roomId);
  if (!room) {
    console.error(`[GameService] Room ${roomId} not found`);
    throw new NotFoundException('Room not found');
  }

  console.log(`[GameService] Room found: ${room.roomName}, players: ${room.currentPlayers}`);

  if (room.hostId.toString() !== hostId) {
    console.error(`[GameService] User ${hostId} is not host of room ${roomId}`);
    throw new ForbiddenException('Only host can start the game');
  }

  if (room.currentPlayers < 2) {
    console.error(`[GameService] Not enough players: ${room.currentPlayers}/2`);
    throw new BadRequestException('Need at least 2 players to start');
  }

  try {
    // Create deck
    const deck = this.createDeck();
    console.log(`[GameService] Created deck with ${deck.length} cards`);
    
    const shuffledDeck = this.shuffleDeck([...deck]);
    console.log(`[GameService] Shuffled deck`);

    // Initialize player states
    const players: PlayerState[] = room.players.map((player, index) => {
      // Deal 7 cards to each player
      const hand = shuffledDeck.splice(0, 7);
      
      console.log(`[GameService] Player ${player.username} gets ${hand.length} cards`);
      
      return {
        userId: player.userId,
        username: player.username,
        seatPosition: index,
        hand,
        cardsCount: hand.length,
        hasPressedCrazyButton: false,
        isActive: true,
        isWinner: false,
        score: 0,
        penaltiesToDraw: 0,
        hasDrawnThisTurn: false,
      };
    });

    // Place first card on discard pile
    const topCard = shuffledDeck.pop();
    if (!topCard) {
      throw new Error('No cards left in deck');
    }
    
    console.log(`[GameService] Top card: ${topCard.rank} of ${topCard.suit}`);

    // Choose random starting player
    const currentPlayerIndex = Math.floor(Math.random() * players.length);
    console.log(`[GameService] Starting player: ${players[currentPlayerIndex].username}`);

    const gameData = {
      roomId,
      players,
      drawPile: shuffledDeck,
      discardPile: [topCard],
      topCard,
      currentSuit: topCard.suit,
      currentDirection: GameDirection.CLOCKWISE,
      currentPlayerIndex,
      status: GameStatus.ACTIVE,
    };

    console.log('[GameService] Creating game in database...');
    const game = await this.gameModel.create(gameData);

    // Update room status
    room.status = RoomStatus.PLAYING;
    room.currentGameId = game._id;
    await room.save();

    console.log(`[GameService] Game created: ${game._id}`);
    console.log(`[GameService] Room ${room._id} updated`);

    return game;
  } catch (error) {
    console.error('[GameService] Error in createGame:', error);
    throw error;
  }
}

  async playCard(
    gameId: string, 
    userId: string, 
    cardId: string,
    selectedSuit?: string
  ): Promise<any> {
    const game = await this.gameModel.findById(gameId);
    if (!game) {
      throw new NotFoundException('Game not found');
    }

    if (game.status !== GameStatus.ACTIVE) {
      throw new BadRequestException('Game is not active');
    }

    const playerIndex = game.players.findIndex(p => p.userId.toString() === userId);
    if (playerIndex === -1) {
      throw new ForbiddenException('You are not in this game');
    }

    if (game.currentPlayerIndex !== playerIndex) {
      throw new BadRequestException('Not your turn');
    }

    const player = game.players[playerIndex];
    
    // Find card in player's hand
    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      throw new BadRequestException('Card not found in hand');
    }

    const card = player.hand[cardIndex];

    // If this player has pending draw penalties, they can only respond by playing a '2'
    if (player.penaltiesToDraw > 0 && card.rank !== '2' && card.id !== 'spades-A') {
      throw new BadRequestException('You must stack with a 2 or A♠, otherwise you must draw your penalty cards');
    }

    // Validate move
    if (!this.isValidMove(card, game.topCard, game.currentSuit, game.isCrazyModeActive)) {
      throw new BadRequestException('Invalid move');
    }

    // Check special rules
    const specialEffects = this.handleSpecialCard(card, game, selectedSuit);

    // Remove card from player's hand
    player.hand.splice(cardIndex, 1);
    player.cardsCount = player.hand.length;

    // Add card to discard pile and update top card
    game.discardPile.push(card);
    game.topCard = card;

    // Update current suit
    if (card.rank === '8' || card.rank === 'J') {
      game.currentSuit = selectedSuit || card.suit;
      game.isCrazyModeActive = true;
      game.selectedSuit = selectedSuit;
    } else {
      game.currentSuit = card.suit;
      game.isCrazyModeActive = false;
      game.selectedSuit = undefined;
    }

    // Handle draw penalties
    if (card.rank === '2') {
      // Stack rule: immediately assign +2 to the NEXT player as a pending penalty.
      // If current player had penaltiesToDraw, they effectively "pass" the stack onward.
      const nextPlayerIndex = this.getNextPlayerIndex(game);
      const carried = player.penaltiesToDraw || 0;
      player.penaltiesToDraw = 0;
      game.players[nextPlayerIndex].penaltiesToDraw =
        (game.players[nextPlayerIndex].penaltiesToDraw || 0) + carried + 2;
      game.drawPenaltyStack = 0;

      // Turn immediately passes to the next player
      game.currentPlayerIndex = nextPlayerIndex;
      game.players[nextPlayerIndex].hasDrawnThisTurn = false;
    } else if (card.id === 'spades-A') {
      // Stack rule: A♠ adds +5, carried forward the same way as 2s
      const nextPlayerIndex = this.getNextPlayerIndex(game);
      const carried = player.penaltiesToDraw || 0;
      player.penaltiesToDraw = 0;
      game.players[nextPlayerIndex].penaltiesToDraw =
        (game.players[nextPlayerIndex].penaltiesToDraw || 0) + carried + 5;
      game.drawPenaltyStack = 0;

      game.currentPlayerIndex = nextPlayerIndex;
      game.players[nextPlayerIndex].hasDrawnThisTurn = false;
    } else {
      // Reset penalty stack if no penalty card played
      if (game.drawPenaltyStack > 0) {
        // Next player must draw penalties
        const nextPlayerIndex = this.getNextPlayerIndex(game);
        game.players[nextPlayerIndex].penaltiesToDraw = game.drawPenaltyStack;
        game.drawPenaltyStack = 0;
      }
    }

    // Check for win
    if (player.hand.length === 0) {
      game.status = GameStatus.FINISHED;
      game.winnerId = player.userId;
      game.finishedAt = new Date();
      player.isWinner = true;

      // Update user stats
      await this.updateUserStats(player.userId.toString(), true);
      for (const p of game.players) {
        if (p.userId.toString() !== player.userId.toString()) {
          await this.updateUserStats(p.userId.toString(), false);
        }
      }
    } else if (card.rank !== '2' && card.id !== 'spades-A') {
      // Move to next player (rank '2' already advanced)
      game.currentPlayerIndex = this.getNextPlayerIndex(game);
      game.players[game.currentPlayerIndex].hasDrawnThisTurn = false;
    }

    // Reset crazy buttons for all players
    game.players.forEach(p => p.hasPressedCrazyButton = false);

    await game.save();

    return {
      success: true,
      topCard: game.topCard,
      nextPlayerIndex: game.currentPlayerIndex,
      drawPenaltyStack: game.drawPenaltyStack,
      isCrazyModeActive: game.isCrazyModeActive,
      selectedSuit: game.selectedSuit,
      players: game.players.map(p => ({
        userId: p.userId,
        username: p.username,
        cardsCount: p.cardsCount,
        isActive: p.isActive,
        penaltiesToDraw: p.penaltiesToDraw,
      })),
      winner: player.hand.length === 0 ? {
        userId: player.userId,
        username: player.username,
      } : null,
      specialEffects,
    };
  }

  async autoResolveTurnIfNeeded(gameId: string): Promise<null | {
    type: 'penalty_draw' | 'auto_draw';
    playerId: string;
    cardsDrawn: Card[];
    canPlayDrawnCard: boolean;
    nextPlayerIndex: number;
    players: any[];
  }> {
    const game = await this.gameModel.findById(gameId);
    if (!game || game.status !== GameStatus.ACTIVE) return null;

    const playerIndex = game.currentPlayerIndex;
    const player = game.players[playerIndex];
    if (!player) return null;

    // If player has penalty and no 2 to stack, auto draw penalties and advance turn
    if (player.penaltiesToDraw > 0) {
      const hasTwo = player.hand.some(c => c.rank === '2');
      if (!hasTwo) {
        const count = player.penaltiesToDraw;
        const cards = this.drawCardsFromDeck(game, count);
        player.hand.push(...cards);
        player.cardsCount = player.hand.length;
        player.penaltiesToDraw = 0;
        game.currentPlayerIndex = this.getNextPlayerIndex(game);
        await game.save();

        return {
          type: 'penalty_draw',
          playerId: player.userId.toString(),
          cardsDrawn: cards,
          canPlayDrawnCard: false,
          nextPlayerIndex: game.currentPlayerIndex,
          players: game.players.map(p => ({
            userId: p.userId.toString(),
            username: p.username,
            cardsCount: p.cardsCount,
            isActive: p.isActive,
            penaltiesToDraw: p.penaltiesToDraw,
            hasPressedCrazyButton: p.hasPressedCrazyButton,
          })),
        };
      }
      return null;
    }

    // If player has no playable card, auto draw 1
    const hasPlayable = player.hand.some(c =>
      this.isValidMove(c, game.topCard, game.currentSuit, game.isCrazyModeActive),
    );
    if (!hasPlayable) {
      const cards = this.drawCardsFromDeck(game, 1);
      player.hand.push(...cards);
      player.cardsCount = player.hand.length;

      const drawn = cards[0];
      const canPlayDrawnCard = drawn
        ? this.isValidMove(drawn, game.topCard, game.currentSuit, game.isCrazyModeActive)
        : false;

      if (!canPlayDrawnCard) {
        game.currentPlayerIndex = this.getNextPlayerIndex(game);
      }

      await game.save();

      return {
        type: 'auto_draw',
        playerId: player.userId.toString(),
        cardsDrawn: cards,
        canPlayDrawnCard,
        nextPlayerIndex: game.currentPlayerIndex,
        players: game.players.map(p => ({
          userId: p.userId.toString(),
          username: p.username,
          cardsCount: p.cardsCount,
          isActive: p.isActive,
          penaltiesToDraw: p.penaltiesToDraw,
          hasPressedCrazyButton: p.hasPressedCrazyButton,
        })),
      };
    }

    return null;
  }

  /**
   * If the current player has a penalty stack but cannot stack it, auto-draw the penalty
   * and advance the turn. This matches: "give the penalty without pressing draw".
   */
  async autoResolvePenaltyIfNeeded(gameId: string): Promise<null | {
    playerId: string;
    username: string;
    cardsDrawn: Card[];
    nextPlayerIndex: number;
  }> {
    const game = await this.gameModel.findById(gameId);
    if (!game || game.status !== GameStatus.ACTIVE) return null;

    const player = game.players[game.currentPlayerIndex];
    if (!player || !player.penaltiesToDraw || player.penaltiesToDraw <= 0) return null;

    const canStack =
      player.hand.some(c => c.rank === '2') ||
      player.hand.some(c => c.id === 'spades-A');
    if (canStack) return null;

    const count = player.penaltiesToDraw;
    const cards = this.drawCardsFromDeck(game, count);
    player.hand.push(...cards);
    player.cardsCount = player.hand.length;
    player.penaltiesToDraw = 0;
    player.hasDrawnThisTurn = true;

    game.currentPlayerIndex = this.getNextPlayerIndex(game);
    game.players[game.currentPlayerIndex].hasDrawnThisTurn = false;

    await game.save();

    return {
      playerId: player.userId.toString(),
      username: player.username,
      cardsDrawn: cards,
      nextPlayerIndex: game.currentPlayerIndex,
    };
  }

  async drawCard(gameId: string, userId: string): Promise<any> {
    const game = await this.gameModel.findById(gameId);
    if (!game) {
      throw new NotFoundException('Game not found');
    }

    const playerIndex = game.players.findIndex(p => p.userId.toString() === userId);
    if (playerIndex === -1) {
      throw new ForbiddenException('You are not in this game');
    }

    if (game.currentPlayerIndex !== playerIndex) {
      throw new BadRequestException('Not your turn');
    }

    const player = game.players[playerIndex];

    // Check if player has penalties to draw first
    if (player.penaltiesToDraw > 0) {
      // Drawing penalty ends the turn
      const cards = this.drawCardsFromDeck(game, player.penaltiesToDraw);
      player.hand.push(...cards);
      player.cardsCount = player.hand.length;
      player.penaltiesToDraw = 0;
      player.hasDrawnThisTurn = true;
      game.currentPlayerIndex = this.getNextPlayerIndex(game);
      game.players[game.currentPlayerIndex].hasDrawnThisTurn = false;
      
      await game.save();
      
      return {
        cardsDrawn: cards,
        isPenalty: true,
        canPlayDrawnCard: false,
        nextPlayerIndex: game.currentPlayerIndex,
      };
    }

    // Allow drawing only once per turn
    if (player.hasDrawnThisTurn) {
      throw new BadRequestException('You already drew a card this turn');
    }

    // Normal draw
    if (game.drawPile.length === 0) {
      // Reshuffle discard pile (except top card)
      const topCard = game.discardPile.pop();
      if (topCard) {
        game.drawPile = this.shuffleDeck(game.discardPile);
        game.discardPile = [topCard];
      }
    }

    const drawnCard = game.drawPile.pop();
    if (!drawnCard) {
      throw new BadRequestException('No cards left in draw pile');
    }

    player.hand.push(drawnCard);
    player.cardsCount = player.hand.length;
    player.hasDrawnThisTurn = true;

    // Check if drawn card is playable
    const canPlayDrawnCard = this.isValidMove(
      drawnCard, 
      game.topCard, 
      game.currentSuit, 
      game.isCrazyModeActive
    );

    if (!canPlayDrawnCard) {
      // Move to next player
      game.currentPlayerIndex = this.getNextPlayerIndex(game);
      game.players[game.currentPlayerIndex].hasDrawnThisTurn = false;
    }

    await game.save();

    return {
      cardsDrawn: [drawnCard],
      canPlayDrawnCard,
      nextPlayerIndex: canPlayDrawnCard ? playerIndex : game.currentPlayerIndex,
    };
  }

  async pressCrazyButton(gameId: string, userId: string): Promise<any> {
    const game = await this.gameModel.findById(gameId);
    if (!game) {
      throw new NotFoundException('Game not found');
    }

    if (!game.isCrazyModeActive) {
      throw new BadRequestException('Crazy mode is not active');
    }

    const playerIndex = game.players.findIndex(p => p.userId.toString() === userId);
    if (playerIndex === -1) {
      throw new ForbiddenException('You are not in this game');
    }

    const player = game.players[playerIndex];
    if (player.hasPressedCrazyButton) {
      throw new BadRequestException('You have already pressed the crazy button');
    }

    // Mark that player pressed the button
    player.hasPressedCrazyButton = true;

    // Check if all other players have pressed the button
    const allPlayersPressed = game.players.every(p => 
      p.userId.toString() === game.players[game.currentPlayerIndex].userId.toString() || 
      p.hasPressedCrazyButton
    );

    let result: any = {
      playerId: userId,
      allPlayersPressed,
    };

    if (allPlayersPressed) {
      // Apply penalty to current player
      const offender = game.players[game.currentPlayerIndex];
      const penaltyCards = this.drawCardsFromDeck(game, 2);
      offender.hand.push(...penaltyCards);
      offender.cardsCount = offender.hand.length;
      
      // Reset crazy mode
      game.isCrazyModeActive = false;
      game.currentSuit = game.topCard.suit;

      result.offenderId = offender.userId;
      result.penaltyCards = penaltyCards;
    }

    await game.save();

    result.players = game.players.map(p => ({
      userId: p.userId,
      username: p.username,
      hasPressedCrazyButton: p.hasPressedCrazyButton,
    }));

    return result;
  }

  async skipTurn(gameId: string, userId: string): Promise<any> {
    const game = await this.gameModel.findById(gameId);
    if (!game) {
      throw new NotFoundException('Game not found');
    }

    const playerIndex = game.players.findIndex(p => p.userId.toString() === userId);
    if (playerIndex === -1) {
      throw new ForbiddenException('You are not in this game');
    }

    if (game.currentPlayerIndex !== playerIndex) {
      throw new BadRequestException('Not your turn');
    }

    const player = game.players[playerIndex];

    if (player.penaltiesToDraw > 0) {
      throw new BadRequestException('You must draw penalty cards or stack with a 2');
    }

    if (player.hasDrawnThisTurn) {
      throw new BadRequestException('You already drew a card this turn');
    }

    // New rule: skip = draw 1 card and end turn (even if you had a playable card)
    const cards = this.drawCardsFromDeck(game, 1);
    player.hand.push(...cards);
    player.cardsCount = player.hand.length;
    player.hasDrawnThisTurn = true;

    // Move to next player
    game.currentPlayerIndex = this.getNextPlayerIndex(game);
    game.players[game.currentPlayerIndex].hasDrawnThisTurn = false;
    await game.save();

    return {
      nextPlayerIndex: game.currentPlayerIndex,
      cardsDrawn: cards,
    };
  }

  /**
   * Force-advance the turn when a player times out.
   * This intentionally bypasses "valid move" checks — it's a game rule.
   */
  async advanceTurnDueToTimeout(gameId: string): Promise<null | {
    timedOutPlayerId: string;
    timedOutUsername: string;
    nextPlayerIndex: number;
  }> {
    const game = await this.gameModel.findById(gameId);
    if (!game) {
      throw new NotFoundException('Game not found');
    }

    if (game.status !== GameStatus.ACTIVE) {
      return null;
    }

    const timedOutPlayer = game.players[game.currentPlayerIndex];
    if (!timedOutPlayer) {
      return null;
    }

    const timedOutPlayerId = timedOutPlayer.userId.toString();
    const timedOutUsername = timedOutPlayer.username;

    game.currentPlayerIndex = this.getNextPlayerIndex(game);
    game.players[game.currentPlayerIndex].hasDrawnThisTurn = false;
    await game.save();

    return {
      timedOutPlayerId,
      timedOutUsername,
      nextPlayerIndex: game.currentPlayerIndex,
    };
  }

  private createDeck(): Card[] {
    const deck: Card[] = [];
    
    for (const suit of this.SUITS) {
      for (const rank of this.RANKS) {
        deck.push({
          suit: suit as any,
          rank: rank as any,
          value: this.VALUES[rank] || 0,
          id: `${suit}-${rank}`,
        });
      }
    }
    
    return deck;
  }

  private shuffleDeck(deck: Card[]): Card[] {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  private isValidMove(
    card: Card, 
    topCard: Card, 
    currentSuit: string,
    isCrazyModeActive: boolean
  ): boolean {
    // Special case: 8 or J cannot be played on another 8 or J
    if ((card.rank === '8' || card.rank === 'J') && 
        (topCard.rank === '8' || topCard.rank === 'J')) {
      return false;
    }

    // In crazy mode, only the selected suit is valid
    if (isCrazyModeActive) {
      return card.suit === currentSuit || card.rank === '8' || card.rank === 'J';
    }

    // Normal validation
    return card.suit === currentSuit || 
           card.rank === topCard.rank || 
           card.rank === '8' || 
           card.rank === 'J';
  }

  private handleSpecialCard(card: Card, game: Game, selectedSuit?: string): any {
    const effects: any = {};

    switch (card.rank) {
      case '5':
        // Reverse direction
        game.currentDirection = game.currentDirection === GameDirection.CLOCKWISE 
          ? GameDirection.COUNTER_CLOCKWISE 
          : GameDirection.CLOCKWISE;
        effects.directionChanged = true;
        effects.newDirection = game.currentDirection;
        break;

      case '7':
        // Mass drop - drop all cards of same suit
        const player = game.players[game.currentPlayerIndex];
        const sameSuitCards = player.hand.filter(c => c.suit === card.suit);
        if (sameSuitCards.length > 0) {
          // Remove all cards of the same suit
          player.hand = player.hand.filter(c => c.suit !== card.suit);
          player.cardsCount = player.hand.length;
          effects.massDrop = true;
          effects.cardsDropped = sameSuitCards.length;
          effects.suit = card.suit;
        }
        break;
    }

    return effects;
  }

  private getNextPlayerIndex(game: Game): number {
    const direction = game.currentDirection === GameDirection.CLOCKWISE ? 1 : -1;
    const playerCount = game.players.length;
    
    let nextIndex = (game.currentPlayerIndex + direction) % playerCount;
    if (nextIndex < 0) nextIndex = playerCount - 1;
    
    return nextIndex;
  }

  private drawCardsFromDeck(game: Game, count: number): Card[] {
    const cards: Card[] = [];
    
    for (let i = 0; i < count; i++) {
      if (game.drawPile.length === 0) {
        // Reshuffle discard pile (except top card)
        const topCard = game.discardPile.pop();
        if (topCard) {
          game.drawPile = this.shuffleDeck(game.discardPile);
          game.discardPile = [topCard];
        }
      }
      
      if (game.drawPile.length > 0) {
        const card = game.drawPile.pop();
        if (card) {
          cards.push(card);
        }
      }
    }
    
    return cards;
  }

  private async updateUserStats(userId: string, won: boolean): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) return;

    user.gamesPlayed += 1;
    if (won) {
      user.gamesWon += 1;
      user.totalScore += 100;
      user.eloRating += 25;
    } else {
      user.eloRating = Math.max(0, user.eloRating - 10);
    }

    user.winRate = user.gamesPlayed > 0 
      ? (user.gamesWon / user.gamesPlayed) * 100 
      : 0;

    await user.save();
  }

  // Helper methods
  async debugGameState(gameId: string): Promise<any> {
    const game = await this.gameModel.findById(gameId);
    if (!game) {
      throw new NotFoundException('Game not found');
    }

    return {
      id: game._id,
      status: game.status,
      currentPlayerIndex: game.currentPlayerIndex,
      topCard: game.topCard,
      currentSuit: game.currentSuit,
      isCrazyModeActive: game.isCrazyModeActive,
      drawPenaltyStack: game.drawPenaltyStack,
      players: game.players.map(p => ({
        username: p.username,
        cardsCount: p.cardsCount,
        penaltiesToDraw: p.penaltiesToDraw,
        hasPressedCrazyButton: p.hasPressedCrazyButton,
      })),
      drawPileCount: game.drawPile.length,
      discardPileCount: game.discardPile.length,
    };
  }

  async getGameById(gameId: string): Promise<Game> {
    const game = await this.gameModel.findById(gameId);
    if (!game) {
      throw new NotFoundException('Game not found');
    }
    return game;
  }

  async getPlayerHand(gameId: string, userId: string): Promise<Card[]> {
    const game = await this.gameModel.findById(gameId);
    if (!game) {
      throw new NotFoundException('Game not found');
    }

    const player = game.players.find(p => p.userId.toString() === userId);
    if (!player) {
      throw new ForbiddenException('You are not in this game');
    }

    return player.hand;
  }
}