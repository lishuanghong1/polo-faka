import { Module } from '@nestjs/common';
import { WeComService } from './wecom.service';

@Module({
  providers: [WeComService],
  exports: [WeComService],
})
export class WeComModule {}
