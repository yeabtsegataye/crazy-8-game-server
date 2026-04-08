// backend/src/config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT, 10) || 3001,
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/crazy8-game',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    expiresIn: '24h',
  },
  game: {
    maxPlayers: 5,
    minPlayers: 2,
    cardsPerPlayer: 7,
    turnTimeLimit: 30, // seconds
  },
});