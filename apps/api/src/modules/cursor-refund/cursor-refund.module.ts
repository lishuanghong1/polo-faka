import { Module } from '@nestjs/common';
import { CursorRefundService } from './cursor-refund.service';

@Module({
  providers: [CursorRefundService],
  exports: [CursorRefundService],
})
export class CursorRefundModule {}
