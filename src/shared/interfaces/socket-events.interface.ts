// backend/src/shared/interfaces/socket-events.interface.ts
export interface SocketEvents {
  // Room Events
  'join-room': { roomId: string };
  'leave-room': { roomId: string };
  'chat-message': { roomId: string; message: string };
  
  // Game Events
  'start-game': { roomId: string };
  'play-card': { 
    roomId: string; 
    gameId: string; 
    cardId: string; 
    selectedSuit?: string;
  };
  'draw-card': { roomId: string; gameId: string };
  'press-crazy-button': { roomId: string; gameId: string };
  'skip-turn': { roomId: string; gameId: string };
  
  // Response Events
  'player-joined': { userId: string; username: string };
  'player-left': { userId: string; username: string };
  'game-started': {
    gameId: string;
    players: any[];
    topCard: any;
    currentPlayerIndex: number;
    currentDirection: string;
  };
  'card-played': {
    playerId: string;
    cardId: string;
    newTopCard: any;
    nextPlayerIndex: number;
    drawPenaltyStack: number;
    isCrazyModeActive: boolean;
    selectedSuit?: string;
    players: any[];
  };
  'card-drawn': {
    playerId: string;
    cardsDrawn: any[];
    canPlayDrawnCard: boolean;
    nextPlayerIndex: number;
  };
  'crazy-button-pressed': {
    playerId: string;
    offenderId: string;
    penaltyCards: number;
    players: any[];
  };
  'turn-skipped': {
    playerId: string;
    nextPlayerIndex: number;
  };
  'game-ended': {
    winner: any;
    players: any[];
  };
}