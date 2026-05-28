import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RechargeStatus } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import dayjs from 'dayjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { VipService } from '../vip/vip.service';

const orderRand = customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 16);

/** 风控参数：每用户每 24h 最多创建多少笔待支付充值单 */
const MAX_PENDING_PER_24H = 30;
/** 风控参数：每用户每 24h 最多成功充值次数 */
const MAX_PAID_PER_24H = 50;

function makeOrderNo(): string {
  return `R${dayjs().format('YYYYMMDDHHmmss')}${orderRand()}`;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class RechargeService {
  private readonly logger = new Logger(RechargeService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private vip: VipService,
  ) {}

  /** 创建一笔 PENDING 充值订单（必须登录），返回订单号供前端走支付宝 */
  async create(userId: number, amount: number, ip?: string) {
    if (!userId) throw new BadRequestException('请先登录');
    const safe = round2(Number(amount));
    if (!Number.isFinite(safe) || safe < 0.01 || safe > 10000) {
      throw new BadRequestException('充值金额不合法');
    }
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('用户不存在');
    if (u.status !== 'ACTIVE') {
      throw new ForbiddenException('当前账号无法充值，请联系客服');
    }

    const since = dayjs().subtract(24, 'hour').toDate();
    const [recentPending, recentPaid] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({
        where: { userId, createdAt: { gte: since }, status: RechargeStatus.PENDING },
      }),
      this.prisma.rechargeOrder.count({
        where: { userId, createdAt: { gte: since }, status: RechargeStatus.PAID },
      }),
    ]);
    if (recentPending >= MAX_PENDING_PER_24H) {
      throw new BadRequestException('待支付充值单过多，请先完成已有充值或稍后再试');
    }
    if (recentPaid >= MAX_PAID_PER_24H) {
      throw new BadRequestException('今日充值次数过多，请明天再试');
    }

    const orderNo = makeOrderNo();
    const expireAt = dayjs().add(15, 'minute').toDate();
    await this.prisma.rechargeOrder.create({
      data: {
        orderNo,
        userId,
        amount: new Prisma.Decimal(safe),
        status: RechargeStatus.PENDING,
        payMethod: 'ALIPAY',
        expireAt,
        ip,
      },
    });
    return { orderNo, amount: safe, expireAt };
  }

  /**
   * 支付宝 notify 回调时调用：金额严格校验 + 幂等 + 入账（同一事务）。
   *
   * 返回：
   *   - 'recorded' = 本次推进成功（首次入账）
   *   - 'already'  = 已是终态（幂等命中）
   * 任何不一致抛错（不存在/金额错/状态非法/已退款等）。
   */
  async markPaidAndCredit(
    orderNo: string,
    tradeNo: string,
    paidAmount: number,
    buyerLogonId?: string,
  ): Promise<'recorded' | 'already'> {
    const order = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('充值订单不存在');

    if (Math.abs(Number(order.amount) - paidAmount) > 0.01) {
      // 金额不一致 → 抛错让 notify 走 ALIPAY_AMOUNT_MISMATCH 路径
      throw new BadRequestException(
        `金额不一致：订单 ¥${order.amount}，支付 ¥${paidAmount}`,
      );
    }

    if (order.status === RechargeStatus.PAID || order.status === RechargeStatus.REFUNDED) {
      return 'already';
    }
    if (order.status !== RechargeStatus.PENDING) {
      throw new BadRequestException(`订单状态 ${order.status} 不允许标记已付款`);
    }

    // 入账：原子事务（订单 PAID + balance increment + BalanceLog + 累计充值 + VIP 升级）
    let txResult: {
      newBalance: number;
      upgraded: boolean;
      from: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
      to: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
    } | null;
    try {
      txResult = await this.prisma.$transaction(async (tx) => {
        // 二次校验状态（防并发）
        const updated = await tx.rechargeOrder.updateMany({
          where: { orderNo, status: RechargeStatus.PENDING },
          data: {
            status: RechargeStatus.PAID,
            thirdTradeNo: tradeNo,
            buyerLogonId: buyerLogonId?.slice(0, 128),
            paidAt: new Date(),
          },
        });
        if (updated.count === 0) {
          // 已经被其他并发请求改掉了 → 当作幂等命中
          return null;
        }
        const u = await tx.user.update({
          where: { id: order.userId },
          data: { balance: { increment: new Prisma.Decimal(Number(order.amount)) } },
        });
        const after = Number(u.balance);
        await tx.balanceLog.create({
          data: {
            userId: order.userId,
            amount: new Prisma.Decimal(Number(order.amount)),
            balance: new Prisma.Decimal(after),
            type: 'RECHARGE',
            note: `充值 ${orderNo}`,
            refOrder: orderNo,
          },
        });
        // 累计充值 + 升级（同一事务）
        const up = await this.vip.accrueRechargeAndUpgrade(
          tx,
          order.userId,
          Number(order.amount),
        );
        return { newBalance: after, upgraded: up.upgraded, from: up.from, to: up.to };
      });
    } catch (e: any) {
      // DB 唯一约束 (refOrder, type=RECHARGE) 命中：说明已经入过账了，幂等命中
      if (e?.code === 'P2002') {
        this.logger.warn(`recharge ${orderNo}: duplicate RECHARGE log blocked by DB unique`);
        return 'already';
      }
      throw e;
    }

    if (!txResult) return 'already';

    await this.audit.record({
      action: AuditActions.BALANCE_RECHARGE,
      target: `recharge:${orderNo}`,
      actorId: order.userId,
      actor: `user:${order.userId}`,
      detail: {
        amount: Number(order.amount),
        tradeNo,
        balanceAfter: txResult.newBalance,
      },
    });
    // 升级审计（非关键路径，事务外）
    if (txResult.upgraded) {
      await this.vip.writeUpgradeAudit(order.userId, txResult.from, txResult.to);
    }
    return 'recorded';
  }

  /** 用户查询单个充值订单（必须是自己的） */
  async detail(orderNo: string, userId: number) {
    const o = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!o || o.userId !== userId) throw new NotFoundException('订单不存在');
    return {
      orderNo: o.orderNo,
      amount: Number(o.amount),
      status: o.status,
      payMethod: o.payMethod,
      paidAt: o.paidAt,
      expireAt: o.expireAt,
      createdAt: o.createdAt,
    };
  }

  /** 用户中心：我的充值记录 */
  async listMine(userId: number, page = 1, pageSize = 20) {
    const where = { userId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where }),
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((o) => ({
        orderNo: o.orderNo,
        amount: Number(o.amount),
        status: o.status,
        payMethod: o.payMethod,
        paidAt: o.paidAt,
        expireAt: o.expireAt,
        createdAt: o.createdAt,
      })),
    };
  }

  /** 定时：把超时未付的 PENDING 充值单标 EXPIRED */
  async expirePendingRecharges() {
    const r = await this.prisma.rechargeOrder.updateMany({
      where: {
        status: RechargeStatus.PENDING,
        expireAt: { lt: new Date() },
      },
      data: { status: RechargeStatus.EXPIRED },
    });
    if (r.count) {
      this.logger.log(`expired ${r.count} pending recharge orders`);
    }
    return r.count;
  }
}
