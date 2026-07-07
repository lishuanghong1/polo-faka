import { Module } from '@nestjs/common';
import { CursorRefundService } from './cursor-refund.service';
import { CursorRefundController } from './cursor-refund.controller';

@Module({
  controllers: [CursorRefundController],
  providers: [CursorRefundService],
  exports: [CursorRefundService],
})
export class CursorRefundModule {}
