import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AlipayService } from '../alipay/alipay.service';
import { OrdersService } from './orders.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

/**
 * 本地订单后台任务：
 *  - EVERY_MINUTE: 把超时 PENDING 订单标 EXPIRED；并对 ALIPAY 订单调 trade.close
 *                  避免用户拿旧链接付款导致悬挂资金。
 *  - EVERY_5_MINUTES: 把 5min 前还 PENDING 的 ALIPAY 订单主动 trade.query 一次，
 *                     防止 notify 丢失导致用户付了钱却拿不到货。
 */
@Injectable()
export class OrdersExpireCron {
  private readonly logger = new Logger(OrdersExpireCron.name);
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => AlipayService)) private alipay: AlipayService,
    private orders: OrdersService,
    private audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpired() {
    const now = new Date();
    // 先取出来需要关闭的 ALIPAY 订单（trade.close）
    const expiringAlipay = await this.prisma.order.findMany({
      where: { status: 'PENDING', payMethod: 'ALIPAY', expireAt: { lt: now } },
      select: { orderNo: true },
      take: 50, // 每分钟最多关 50 个，避免一次性打爆 alipay
    });

    // 再批量把所有过期 PENDING 标 EXPIRED（包括非 ALIPAY 的）
    const r = await this.prisma.order.updateMany({
      where: { status: 'PENDING', expireAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    if (r.count > 0) {
      this.logger.log(`closed ${r.count} expired local orders`);
    }

    if (expiringAlipay.length > 0 && (await this.alipay.isEnabled())) {
      for (const o of expiringAlipay) {
        const res = await this.alipay.tradeClose(o.orderNo);
        if (!res.ok) {
          this.logger.warn(`tradeClose ${o.orderNo} failed: ${res.reason}`);
        }
      }
      await this.audit
        .record({
          action: AuditActions.ALIPAY_AUTO_CLOSE,
          detail: { count: expiringAlipay.length },
        })
        .catch(() => undefined);
    }
  }

  /**
   * 兜底：notify 丢失时主动 query。
   * 只查"创建超过 90s 且仍 PENDING 且未过期"的订单，避免在用户付款前打扰支付宝。
   * 每次最多查 20 单，串行执行，避免触发支付宝侧限流。
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverLostNotify() {
    if (!(await this.alipay.isEnabled())) return;
    const cutoff = new Date(Date.now() - 90 * 1000);
    const list = await this.prisma.order.findMany({
      where: {
        status: 'PENDING',
        payMethod: 'ALIPAY',
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
          const x = await this.orders.markPaidOnly(
            o.orderNo,
            r.tradeNo!,
            r.totalAmount!,
            r.buyerLogonId,
          );
          if (x === 'recorded') {
            this.orders.deliverAsync(o.orderNo);
            recovered++;
            await this.audit
              .record({
                action: AuditActions.ALIPAY_AUTO_RECOVER,
                target: `order:${o.orderNo}`,
                detail: { tradeNo: r.tradeNo, amount: r.totalAmount },
              })
              .catch(() => undefined);
          }
        }
      } catch (e) {
        this.logger.warn(`recoverLostNotify ${o.orderNo}: ${(e as Error).message}`);
      }
    }
    if (recovered) this.logger.log(`recovered ${recovered} local orders via tradeQuery`);
  }
}
