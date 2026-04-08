// backend/src/game/game.controller.ts
import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GameService } from './game.service';

@Controller('games')
@UseGuards(AuthGuard('jwt'))
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Get(':id')
  async getGame(@Param('id') id: string) {
    // Note: In production, add authorization check
    return { message: 'Game endpoint' };
  }
}