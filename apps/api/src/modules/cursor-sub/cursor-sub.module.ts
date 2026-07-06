import { Module } from '@nestjs/common';
import { CursorSubController } from './cursor-sub.controller';
import { CursorSubService } from './cursor-sub.service';
import { CursorUsageService } from './cursor-usage.service';
import { CursorCheckoutService } from './cursor-checkout.service';
import { WarehouseModule } from '../warehouse/warehouse.module';

@Module({
  imports: [WarehouseModule],
  controllers: [CursorSubController],
  providers: [CursorSubService, CursorUsageService, CursorCheckoutService],
  exports: [CursorSubService],
})
export class CursorSubModule {}
