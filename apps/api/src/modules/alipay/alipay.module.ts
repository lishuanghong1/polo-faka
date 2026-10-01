import { Module, forwardRef } from '@nestjs/common';
import { AlipayService } from './alipay.service';
import { AlipayController } from './alipay.controller';
import { OrdersModule } from '../orders/orders.module';
import { RechargeModule } from '../recharge/recharge.module';
import { CustomerRefundModule } from '../customer-refund/customer-refund.module';

@Module({
  imports: [
    forwardRef(() => OrdersModule),
    RechargeModule,
    CustomerRefundModule,
  ],
  controllers: [AlipayController],
  providers: [AlipayService],
  exports: [AlipayService],
})
export class AlipayModule {}
