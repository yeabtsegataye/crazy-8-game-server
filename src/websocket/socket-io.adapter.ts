// backend/src/websocket/socket-io.adapter.ts
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

export class SocketIOAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions): any {
    const defaultCorsOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://crazy-8-game-front.onrender.com',
    ];
    const corsOrigins =
      process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ??
      defaultCorsOrigins;

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: corsOrigins,
        credentials: true,
      },
    });

    return server;
  }
}