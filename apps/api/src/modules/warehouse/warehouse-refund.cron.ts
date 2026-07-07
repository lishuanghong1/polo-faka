import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WarehouseService } from './warehouse.service';

/**
 * 每分钟扫一遍到点的售出账号：
 *   - 开启 Cursor 自动退款 → 直接退款并推企微结果
 *   - 否则 → 仅推企微提醒（人工去退）
 */
@Injectable()
export class WarehouseRefundCron {
  private readonly logger = new Logger(WarehouseRefundCron.name);

  constructor(private warehouse: WarehouseService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try {
      await this.warehouse.processDueRefunds();
    } catch (e) {
      this.logger.error(`refund cron: ${(e as Error).message}`);
    }
  }
}
