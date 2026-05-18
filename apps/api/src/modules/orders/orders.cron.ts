import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/** 自动关闭超时未支付订单（每分钟跑一次） */
@Injectable()
export class OrdersExpireCron {
  private readonly logger = new Logger(OrdersExpireCron.name);
  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpired() {
    const r = await this.prisma.order.updateMany({
      where: { status: 'PENDING', expireAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    if (r.count > 0) {
      this.logger.log(`closed ${r.count} expired orders`);
    }
  }
}
