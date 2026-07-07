import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { WarehouseRefundCron } from './warehouse-refund.cron';
import { WeComModule } from '../wecom/wecom.module';
import { CursorRefundModule } from '../cursor-refund/cursor-refund.module';

@Module({
  imports: [WeComModule, CursorRefundModule],
  controllers: [WarehouseController],
  providers: [WarehouseService, WarehouseRefundCron],
  exports: [WarehouseService],
})
export class WarehouseModule {}
