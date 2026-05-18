import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersExpireCron } from './orders.cron';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersExpireCron],
  exports: [OrdersService],
})
export class OrdersModule {}
