// backend/src/websocket/websocket.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameModule } from '../game/game.module';
import { RoomModule } from '../room/room.module';
import { AuthModule } from '../auth/auth.module';
import { WebsocketGateway } from './websocket.gateway';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    GameModule,
    RoomModule,
    AuthModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: '24h',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [WebsocketGateway],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}