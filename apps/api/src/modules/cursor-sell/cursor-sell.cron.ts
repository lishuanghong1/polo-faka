import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WeComService } from '../wecom/wecom.service';
import { CursorSellService } from './cursor-sell.service';
import { CursorSellCatalogService } from './cursor-sell-catalog.service';
import { CursorSellFulfilService } from './cursor-sell-fulfil.service';

/**
 * Team 渠道后台任务：
 *  - 每分钟：轮询现做 Team（making）的成交单，就绪后回填凭据并推进订单
 *  - 每 5 分钟：重试停在 PENDING 的订单采购单（同一幂等键，不会重复扣费）
 *  - 每 10 分钟：同步上游商品缓存（价格 / 库存 / 交付字段）
 *  - 每小时：售号钱包余额低于阈值时推企微提醒（同一天只提醒一次）
 */
@Injectable()
export class CursorSellCron {
  private readonly logger = new Logger(CursorSellCron.name);
  private lowBalanceNotifiedDay = '';

  constructor(
    private prisma: PrismaService,
    private api: CursorSellService,
    private catalog: CursorSellCatalogService,
    private fulfil: CursorSellFulfilService,
    private wecom: WeComService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async pollMaking() {
    if (!(await this.api.isEnabled())) return;
    try {
      const r = await this.fulfil.pollMaking(20);
      if (r.ready > 0) this.logger.log(`making poll: ${r.ready}/${r.checked} ready`);
    } catch (e) {
      this.logger.warn(`pollMaking failed: ${(e as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPending() {
    if (!(await this.api.isEnabled())) return;
    const cutoff = new Date(Date.now() - 4 * 60 * 1000);
    const list = await this.prisma.cursorSellPurchase.findMany({
      where: {
        status: 'PENDING',
        source: 'ORDER',
        orderNo: { not: null },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: cutoff } }],
      },
      select: { orderNo: true },
      distinct: ['orderNo'],
      take: 20,
    });
    for (const p of list) {
      try {
        await this.fulfil.redeliverOrder(p.orderNo!);
      } catch (e) {
        this.logger.warn(`retry ${p.orderNo}: ${(e as Error).message}`);
      }
    }
    if (list.length) this.logger.log(`retried ${list.length} pending cursor-sell orders`);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncProducts() {
    if (!(await this.api.isEnabled()) || !(await this.api.hasApiKey())) return;
    try {
      await this.catalog.sync();
    } catch (e) {
      this.logger.warn(`syncProducts failed: ${(e as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async lowBalanceAlert() {
    const cfg = await this.api.loadConfig();
    if (!cfg || !cfg.apiKey || !cfg.lowBalanceCents) return;
    const today = new Date().toISOString().slice(0, 10);
    if (this.lowBalanceNotifiedDay === today) return;
    try {
      const { balanceCents } = await this.api.getWallet();
      if (balanceCents < cfg.lowBalanceCents) {
        await this.wecom.sendMarkdown(
          `## 💰 Team 渠道余额不足\n> 售号钱包余额 **¥${(balanceCents / 100).toFixed(2)}**，低于阈值 ¥${(cfg.lowBalanceCents / 100).toFixed(2)}\n\n余额不足时订单会卡在「已支付待发货」，请尽快到后台「Team 渠道」兑换充值卡。`,
        );
        this.lowBalanceNotifiedDay = today;
      }
    } catch (e) {
      this.logger.warn(`lowBalanceAlert failed: ${(e as Error).message}`);
    }
  }
}
