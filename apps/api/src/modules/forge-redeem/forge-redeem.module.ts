import { Module } from '@nestjs/common';
import { ForgeRedeemController } from './forge-redeem.controller';
import { ForgeRedeemAdminController } from './forge-redeem-admin.controller';
import { ForgeProductsService } from './forge-products.service';
import { ForgeRedeemCodesService } from './forge-redeem-codes.service';
import { ForgeOrdersService } from './forge-orders.service';
import { ForgeOrdersCron } from './forge-orders.cron';
import { ForgeOpenapiModule } from '../forge-openapi/forge-openapi.module';

@Module({
  imports: [ForgeOpenapiModule],
  controllers: [ForgeRedeemController, ForgeRedeemAdminController],
  providers: [
    ForgeProductsService,
    ForgeRedeemCodesService,
    ForgeOrdersService,
    ForgeOrdersCron,
  ],
  exports: [ForgeOrdersService, ForgeProductsService],
})
export class ForgeRedeemModule {}
