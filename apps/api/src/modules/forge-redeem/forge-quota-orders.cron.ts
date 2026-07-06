import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ForgeQuotaOrdersService } from './forge-quota-orders.service';
import { AlipayService } from '../alipay/alipay.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

/**
 * 额度包订单后台任务（与成品号订单同一套节奏）：
 *  - EVERY_MINUTE: 过期未付 PENDING → EXPIRED；并对其 trade.close
 *  - 每 2 分钟: 自动重试 NETWORK_ERROR 类发货失败
 *  - EVERY_5_MINUTES: 主动 trade.query 兜底 notify 丢失
 */
@Injectable()
export class ForgeQuotaOrdersCron {
  private readonly logger = new Logger(ForgeQuotaOrdersCron.name);
  constructor(
    private orders: ForgeQuotaOrdersService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => AlipayService)) private alipay: AlipayService,
    private audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdue() {
    try {
      const now = new Date();
      const expiringAlipay = await this.prisma.forgeQuotaOrder.findMany({
        where: {
          status: 'PENDING',
          paymentMethod: 'ALIPAY',
          expireAt: { lt: now },
        },
        select: { orderNo: true },
        take: 50,
      });

      await this.orders.expirePendingOrders();

      if (expiringAlipay.length > 0 && (await this.alipay.isEnabled())) {
        for (const o of expiringAlipay) {
          const res = await this.alipay.tradeClose(o.orderNo);
          if (!res.ok) {
            this.logger.warn(`quota tradeClose ${o.orderNo} failed: ${res.reason}`);
          }
        }
        await this.audit
          .record({
            action: AuditActions.ALIPAY_AUTO_CLOSE,
            detail: { count: expiringAlipay.length, scope: 'forge-quota' },
          })
          .catch(() => undefined);
      }
    } catch (e) {
      this.logger.error(`expireOverdue: ${(e as Error).message}`);
    }
  }

  /**
   * 自动重试因网络抖动失败的购码订单（策略同成品号：
   * 30 分钟窗口 / 单订单 2 分钟间隔 / 每轮最多 10 个）。
   * 上游幂等由 external_order_id 保证，重试不会重复扣款。
   */
  @Cron('*/2 * * * *')
  async retryFailedNetworkErrors() {
    try {
      const now = Date.now();
      const createdSince = new Date(now - 30 * 60 * 1000);
      const updatedBefore = new Date(now - 2 * 60 * 1000);

      const candidates = await this.prisma.forgeQuotaOrder.findMany({
        where: {
          status: 'FAILED',
          failReason: { startsWith: 'NETWORK_ERROR:' },
          createdAt: { gt: createdSince },
          updatedAt: { lt: updatedBefore },
        },
        select: { orderNo: true },
        orderBy: { id: 'asc' },
        take: 10,
      });
      if (!candidates.length) return;

      let recovered = 0;
      for (const o of candidates) {
        try {
          await this.orders.fulfillOrder(o.orderNo);
          recovered++;
        } catch (e) {
          this.logger.warn(
            `auto-retry quota ${o.orderNo} still failed: ${(e as Error).message}`,
          );
        }
      }
      if (recovered) {
        this.logger.log(
          `auto-retry recovered ${recovered}/${candidates.length} quota orders from NETWORK_ERROR`,
        );
      }
    } catch (e) {
      this.logger.error(`retryFailedNetworkErrors: ${(e as Error).message}`);
    }
  }

  /** 兜底主动查询，捕获 notify 丢失 */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverLostNotify() {
    if (!(await this.alipay.isEnabled())) return;
    const cutoff = new Date(Date.now() - 90 * 1000);
    const list = await this.prisma.forgeQuotaOrder.findMany({
      where: {
        status: 'PENDING',
        paymentMethod: 'ALIPAY',
        createdAt: { lt: cutoff },
        expireAt: { gt: new Date() },
      },
      select: { orderNo: true },
      take: 20,
    });
    if (!list.length) return;

    let recovered = 0;
    for (const o of list) {
      try {
        const r = await this.alipay.tradeQuery(o.orderNo);
        if (r.tradeStatus === 'TRADE_SUCCESS' || r.tradeStatus === 'TRADE_FINISHED') {
          const x = await this.orders.markPaid(
            o.orderNo,
            r.tradeNo!,
            r.totalAmount!,
            r.buyerLogonId,
          );
          if (x === 'recorded') {
            this.orders.fulfillAsync(o.orderNo);
            recovered++;
            await this.audit
              .record({
                action: AuditActions.ALIPAY_AUTO_RECOVER,
                target: `forge-quota:${o.orderNo}`,
                detail: { tradeNo: r.tradeNo, amount: r.totalAmount },
              })
              .catch(() => undefined);
          }
        }
      } catch (e) {
        this.logger.warn(`recoverLostNotify quota ${o.orderNo}: ${(e as Error).message}`);
      }
    }
    if (recovered) this.logger.log(`recovered ${recovered} quota orders via tradeQuery`);
  }
}
