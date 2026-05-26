import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ForgeOrdersService } from './forge-orders.service';

@Injectable()
export class ForgeOrdersCron {
  private readonly logger = new Logger(ForgeOrdersCron.name);
  constructor(private orders: ForgeOrdersService) {}

  /** 每分钟把超时未付 PENDING 订单标 EXPIRED */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdue() {
    try {
      await this.orders.expirePendingOrders();
    } catch (e) {
      this.logger.error(`expireOverdue: ${(e as Error).message}`);
    }
  }
}
