import { Module } from '@nestjs/common';
import { CardKeysController } from './card-keys.controller';
import { CardKeysService } from './card-keys.service';

@Module({
  controllers: [CardKeysController],
  providers: [CardKeysService],
  exports: [CardKeysService],
})
export class CardKeysModule {}
