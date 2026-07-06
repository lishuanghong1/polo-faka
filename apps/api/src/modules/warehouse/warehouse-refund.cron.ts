import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WarehouseService } from './warehouse.service';

/**
 * 每分钟扫一遍「已售出 & 到退款时间 & 未通知」的仓库账号，
 * 把完整账号信息推到企业微信群机器人，推成功后打上已通知标记。
 */
@Injectable()
export class WarehouseRefundCron {
  private readonly logger = new Logger(WarehouseRefundCron.name);

  constructor(private warehouse: WarehouseService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try {
      await this.warehouse.runRefundNotifications();
    } catch (e) {
      this.logger.error(`refund notify cron: ${(e as Error).message}`);
    }
  }
}
