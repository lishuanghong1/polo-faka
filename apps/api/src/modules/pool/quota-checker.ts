import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PoolService } from './pool.service';

@Injectable()
export class PoolQuotaChecker {
  private readonly logger = new Logger(PoolQuotaChecker.name);

  constructor(private pool: PoolService) {}

  /** 每 10 分钟刷新一次所有号池账号的额度 */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick() {
    if (process.env.POOL_AUTO_REFRESH === 'false') return;
    try {
      const res = await this.pool.refreshAllAccounts();
      this.logger.log(`pool refresh: ${res.length} accounts checked`);
    } catch (e: any) {
      this.logger.warn(`pool refresh failed: ${e.message}`);
    }
  }
}
