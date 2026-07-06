import { Module, forwardRef } from '@nestjs/common';
import { ForgeRedeemController } from './forge-redeem.controller';
import { ForgeRedeemAdminController } from './forge-redeem-admin.controller';
import { ForgeQuotaController } from './forge-quota.controller';
import { ForgeQuotaAdminController } from './forge-quota-admin.controller';
import { ForgeProductsService } from './forge-products.service';
import { ForgeRedeemCodesService } from './forge-redeem-codes.service';
import { ForgeOrdersService } from './forge-orders.service';
import { ForgeOrdersCron } from './forge-orders.cron';
import { ForgeQuotaPackagesService } from './forge-quota-packages.service';
import { ForgeQuotaOrdersService } from './forge-quota-orders.service';
import { ForgeQuotaOrdersCron } from './forge-quota-orders.cron';
import { ForgeOpenapiModule } from '../forge-openapi/forge-openapi.module';
import { AlipayModule } from '../alipay/alipay.module';
import { VipModule } from '../vip/vip.module';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [ForgeOpenapiModule, forwardRef(() => AlipayModule), VipModule, PointsModule],
  controllers: [
    ForgeRedeemController,
    ForgeRedeemAdminController,
    ForgeQuotaController,
    ForgeQuotaAdminController,
  ],
  providers: [
    ForgeProductsService,
    ForgeRedeemCodesService,
    ForgeOrdersService,
    ForgeOrdersCron,
    ForgeQuotaPackagesService,
    ForgeQuotaOrdersService,
    ForgeQuotaOrdersCron,
  ],
  exports: [
    ForgeOrdersService,
    ForgeProductsService,
    ForgeQuotaOrdersService,
    ForgeQuotaPackagesService,
  ],
})
export class ForgeRedeemModule {}
