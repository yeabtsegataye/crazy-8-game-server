// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { GameModule } from './game/game.module';
import { RoomModule } from './room/room.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRoot('mongodb+srv://tatipassword:tatipassword@cluster0.j12sxcz.mongodb.net/crazy8-game'),
    AuthModule,
    UserModule,
    GameModule,
    RoomModule,
    WebsocketModule,
  ],
})
export class AppModule {}