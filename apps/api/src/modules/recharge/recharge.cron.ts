import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RechargeService } from './recharge.service';
import { AlipayService } from '../alipay/alipay.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

/**
 * 充值订单后台任务：
 *  - EVERY_MINUTE: 过期未付 PENDING → EXPIRED + tradeClose
 *  - EVERY_5_MINUTES: 主动 tradeQuery 兜底 notify 丢失
 */
@Injectable()
export class RechargeCron {
  private readonly logger = new Logger(RechargeCron.name);

  constructor(
    private svc: RechargeService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => AlipayService)) private alipay: AlipayService,
    private audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdue() {
    try {
      const now = new Date();
      const expiring = await this.prisma.rechargeOrder.findMany({
        where: { status: 'PENDING', expireAt: { lt: now } },
        select: { orderNo: true },
        take: 50,
      });

      await this.svc.expirePendingRecharges();

      if (expiring.length > 0 && (await this.alipay.isEnabled())) {
        for (const o of expiring) {
          const res = await this.alipay.tradeClose(o.orderNo);
          if (!res.ok) {
            this.logger.warn(`recharge tradeClose ${o.orderNo} failed: ${res.reason}`);
          }
        }
        await this.audit
          .record({
            action: AuditActions.ALIPAY_AUTO_CLOSE,
            detail: { count: expiring.length, scope: 'recharge' },
          })
          .catch(() => undefined);
      }
    } catch (e) {
      this.logger.error(`expireOverdue: ${(e as Error).message}`);
    }
  }

  /** 兜底：notify 丢失时主动 tradeQuery 补救 */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverLostNotify() {
    if (!(await this.alipay.isEnabled())) return;
    const cutoff = new Date(Date.now() - 90 * 1000);
    const list = await this.prisma.rechargeOrder.findMany({
      where: {
        status: 'PENDING',
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
          const x = await this.svc.markPaidAndCredit(
            o.orderNo,
            r.tradeNo!,
            r.totalAmount!,
            r.buyerLogonId,
          );
          if (x === 'recorded') {
            recovered++;
            await this.audit
              .record({
                action: AuditActions.ALIPAY_AUTO_RECOVER,
                target: `recharge:${o.orderNo}`,
                detail: { tradeNo: r.tradeNo, amount: r.totalAmount },
              })
              .catch(() => undefined);
          }
        }
      } catch (e) {
        this.logger.warn(`recoverLostNotify ${o.orderNo}: ${(e as Error).message}`);
      }
    }
    if (recovered) this.logger.log(`recovered ${recovered} recharge orders via tradeQuery`);
  }
}
