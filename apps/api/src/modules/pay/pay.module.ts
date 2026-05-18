import { Module } from '@nestjs/common';
import { PayController } from './pay.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [PayController],
})
export class PayModule {}
