import { Module } from '@nestjs/common';
import { CursorSellController } from './cursor-sell.controller';
import { CursorSellService } from './cursor-sell.service';

@Module({
  controllers: [CursorSellController],
  providers: [CursorSellService],
  exports: [CursorSellService],
})
export class CursorSellModule {}
