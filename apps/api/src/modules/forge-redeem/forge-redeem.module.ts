import { Module, forwardRef } from '@nestjs/common';
import { ForgeRedeemController } from './forge-redeem.controller';
import { ForgeRedeemAdminController } from './forge-redeem-admin.controller';
import { ForgeProductsService } from './forge-products.service';
import { ForgeRedeemCodesService } from './forge-redeem-codes.service';
import { ForgeOrdersService } from './forge-orders.service';
import { ForgeOrdersCron } from './forge-orders.cron';
import { ForgeOpenapiModule } from '../forge-openapi/forge-openapi.module';
import { AlipayModule } from '../alipay/alipay.module';
import { VipModule } from '../vip/vip.module';

@Module({
  imports: [ForgeOpenapiModule, forwardRef(() => AlipayModule), VipModule],
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
