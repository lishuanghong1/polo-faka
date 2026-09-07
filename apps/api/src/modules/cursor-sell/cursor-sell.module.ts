import { Module } from '@nestjs/common';
import { CursorSellController } from './cursor-sell.controller';
import { CursorSellAdminController } from './cursor-sell-admin.controller';
import { CursorSellService } from './cursor-sell.service';
import { CursorSellCatalogService } from './cursor-sell-catalog.service';
import { CursorSellFulfilService } from './cursor-sell-fulfil.service';
import { CursorSellListingService } from './cursor-sell-listing.service';
import { CursorSellCron } from './cursor-sell.cron';
import { PointsModule } from '../points/points.module';
import { WeComModule } from '../wecom/wecom.module';
import { WarehouseModule } from '../warehouse/warehouse.module';

@Module({
  imports: [PointsModule, WeComModule, WarehouseModule],
  controllers: [CursorSellController, CursorSellAdminController],
  providers: [
    CursorSellService,
    CursorSellCatalogService,
    CursorSellListingService,
    CursorSellFulfilService,
    CursorSellCron,
  ],
  exports: [CursorSellService, CursorSellCatalogService, CursorSellListingService, CursorSellFulfilService],
})
export class CursorSellModule {}
