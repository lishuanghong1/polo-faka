import { Module } from '@nestjs/common';
import { RecycleController } from './recycle.controller';
import { RecycleService } from './recycle.service';
import { WeComModule } from '../wecom/wecom.module';

@Module({
  imports: [WeComModule],
  controllers: [RecycleController],
  providers: [RecycleService],
})
export class RecycleModule {}
