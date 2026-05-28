import { forwardRef, Module } from '@nestjs/common';
import { RechargeController } from './recharge.controller';
import { RechargeService } from './recharge.service';
import { RechargeCron } from './recharge.cron';
import { AlipayModule } from '../alipay/alipay.module';
import { VipModule } from '../vip/vip.module';

@Module({
  imports: [forwardRef(() => AlipayModule), VipModule],
  controllers: [RechargeController],
  providers: [RechargeService, RechargeCron],
  exports: [RechargeService],
})
export class RechargeModule {}
