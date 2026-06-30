import { Module } from '@nestjs/common';
import { AizhpOpenController } from './aizhp-open.controller';
import { AizhpOpenService } from './aizhp-open.service';

@Module({
  controllers: [AizhpOpenController],
  providers: [AizhpOpenService],
  exports: [AizhpOpenService],
})
export class AizhpOpenModule {}
