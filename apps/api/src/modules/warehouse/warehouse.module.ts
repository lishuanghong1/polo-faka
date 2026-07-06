import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { WarehouseRefundCron } from './warehouse-refund.cron';
import { WeComModule } from '../wecom/wecom.module';

@Module({
  imports: [WeComModule],
  controllers: [WarehouseController],
  providers: [WarehouseService, WarehouseRefundCron],
  exports: [WarehouseService],
})
export class WarehouseModule {}
