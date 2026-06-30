import { Module, forwardRef } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersExpireCron } from './orders.cron';
import { AlipayModule } from '../alipay/alipay.module';
import { VipModule } from '../vip/vip.module';
import { PoolModule } from '../pool/pool.module';
import { PointsModule } from '../points/points.module';
import { AizhpOpenModule } from '../aizhp-open/aizhp-open.module';

@Module({
  imports: [forwardRef(() => AlipayModule), VipModule, PoolModule, PointsModule, AizhpOpenModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersExpireCron],
  exports: [OrdersService],
})
export class OrdersModule {}
