import { Module } from '@nestjs/common';
import { CursorToolsController } from './cursor-tools.controller';
import { CursorToolsService } from './cursor-tools.service';

@Module({
  controllers: [CursorToolsController],
  providers: [CursorToolsService],
})
export class CursorToolsModule {}
