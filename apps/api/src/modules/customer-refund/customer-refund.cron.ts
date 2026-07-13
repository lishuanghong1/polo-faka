import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CustomerRefundService } from './customer-refund.service';

/** 恢复服务重启或进程异常后遗留的 Token 退款任务。 */
@Injectable()
export class CustomerRefundCron {
  private readonly logger = new Logger(CustomerRefundCron.name);

  constructor(private readonly refunds: CustomerRefundService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async recoverInterruptedTokenRefunds() {
    try {
      await this.refunds.recoverStaleTokenRefunds();
    } catch (e) {
      this.logger.error(`recover token refunds: ${(e as Error).message}`);
    }
  }
}
