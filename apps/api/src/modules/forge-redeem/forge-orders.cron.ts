import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ForgeOrdersService } from './forge-orders.service';
import { AlipayService } from '../alipay/alipay.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

/**
 * 三方订单后台任务：
 *  - EVERY_MINUTE: 过期未付 PENDING → EXPIRED；并对其 trade.close
 *  - EVERY_5_MINUTES: 主动 trade.query 兜底 notify 丢失
 */
@Injectable()
export class ForgeOrdersCron {
  private readonly logger = new Logger(ForgeOrdersCron.name);
  constructor(
    private orders: ForgeOrdersService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => AlipayService)) private alipay: AlipayService,
    private audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdue() {
    try {
      // 先取一份"即将过期的 ALIPAY 待支付订单"快照（用于关闭支付宝侧）
      const now = new Date();
      const expiringAlipay = await this.prisma.forgeOrder.findMany({
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
            this.logger.warn(`forge tradeClose ${o.orderNo} failed: ${res.reason}`);
          }
        }
        await this.audit
          .record({
            action: AuditActions.ALIPAY_AUTO_CLOSE,
            detail: { count: expiringAlipay.length, scope: 'forge' },
          })
          .catch(() => undefined);
      }
    } catch (e) {
      this.logger.error(`expireOverdue: ${(e as Error).message}`);
    }
  }

  /**
   * 自动重试因网络抖动失败的发货订单。
   *
   * 只重试 NETWORK_ERROR 类失败（DNS/TCP/超时/5xx），业务错误（OUT_OF_STOCK /
   * INSUFFICIENT_BALANCE 等）不会被重试 —— 那种错误重试也是同样的结果，
   * 还会浪费上游配额。
   *
   * 节流策略：
   *  - createdAt 在最近 30 分钟内：超过 30 分钟的失败大概率不是临时问题，停止重试
   *  - updatedAt 距今 ≥ 2 分钟：单订单两次重试之间至少间隔 2 分钟，避免打爆上游
   *  - 每轮最多 10 个：限制上游 QPS
   * 实际单订单最多重试 ~14 次，分布在 30 分钟内。
   */
  @Cron('*/2 * * * *')
  async retryFailedNetworkErrors() {
    try {
      const now = Date.now();
      const createdSince = new Date(now - 30 * 60 * 1000);
      const updatedBefore = new Date(now - 2 * 60 * 1000);

      const candidates = await this.prisma.forgeOrder.findMany({
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
          // fulfillOrder 已经把最新的 failReason 写回 DB，这里只记日志
          this.logger.warn(
            `auto-retry forge ${o.orderNo} still failed: ${(e as Error).message}`,
          );
        }
      }
      if (recovered) {
        this.logger.log(
          `auto-retry recovered ${recovered}/${candidates.length} forge orders from NETWORK_ERROR`,
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
    const list = await this.prisma.forgeOrder.findMany({
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
                target: `forge:${o.orderNo}`,
                detail: { tradeNo: r.tradeNo, amount: r.totalAmount },
              })
              .catch(() => undefined);
          }
        }
      } catch (e) {
        this.logger.warn(`recoverLostNotify ${o.orderNo}: ${(e as Error).message}`);
      }
    }
    if (recovered) this.logger.log(`recovered ${recovered} forge orders via tradeQuery`);
  }
}
