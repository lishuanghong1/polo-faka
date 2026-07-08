import { Module, forwardRef } from '@nestjs/common';
import { AlipayService } from './alipay.service';
import { AlipayController } from './alipay.controller';
import { OrdersModule } from '../orders/orders.module';
import { ForgeRedeemModule } from '../forge-redeem/forge-redeem.module';
import { RechargeModule } from '../recharge/recharge.module';
import { CustomerRefundModule } from '../customer-refund/customer-refund.module';

@Module({
  imports: [
    forwardRef(() => OrdersModule),
    forwardRef(() => ForgeRedeemModule),
    RechargeModule,
    CustomerRefundModule,
  ],
  controllers: [AlipayController],
  providers: [AlipayService],
  exports: [AlipayService],
})
export class AlipayModule {}
