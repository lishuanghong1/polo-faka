import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';

const inviteCodeRand = customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 8);
/** 全局默认返积分倍率：商品未单独配置 pointsAwardRate 时使用 */
const POINT_REWARD_RATE = 0.1;

type Tx = Prisma.TransactionClient;

@Injectable()
export class PointsService {
  constructor(private prisma: PrismaService) {}

  private makeInviteCode(userId: number) {
    return `P${userId.toString(36).toUpperCase()}${inviteCodeRand()}`.slice(0, 16);
  }

  /**
   * 计算消费返积分数量。
   * @param amount 实付金额（CNY）
   * @param rateOverride 商品级覆盖倍率（Decimal 或 null/undefined）。
   *                     null/undefined → 走全局默认 10%。
   *                     越界值会被夹到 [0, 1] 范围。
   */
  rewardForAmount(amount: number, rateOverride?: Prisma.Decimal | number | null) {
    const safeAmount = Number(amount || 0);
    let rate = POINT_REWARD_RATE;
    if (rateOverride !== undefined && rateOverride !== null) {
      const r = Number(rateOverride);
      if (Number.isFinite(r)) {
        rate = Math.max(0, Math.min(1, r));
      }
    }
    return Math.floor(safeAmount * rate);
  }

  pointsRequiredForAmount(amount: number) {
    return Math.ceil(Number(amount || 0));
  }

  async ensureInviteCode(userId: number, tx: Tx = this.prisma) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, inviteCode: true },
    });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.inviteCode) return user.inviteCode;

    for (let i = 0; i < 8; i++) {
      const code = this.makeInviteCode(userId);
      try {
        await tx.user.update({
          where: { id: userId },
          data: { inviteCode: code },
        });
        return code;
      } catch (e: any) {
        if (e?.code !== 'P2002' || i === 7) throw e;
      }
    }
    throw new BadRequestException('邀请码生成失败，请重试');
  }

  async bindInviterForRegister(userId: number, inviteCode?: string | null, tx: Tx = this.prisma) {
    const code = (inviteCode || '').trim().toUpperCase();
    await this.ensureInviteCode(userId, tx);
    if (!code) return null;

    const inviter = await tx.user.findUnique({
      where: { inviteCode: code },
      select: { id: true, status: true },
    });
    if (!inviter || inviter.status !== 'ACTIVE') {
      throw new BadRequestException('邀请码不存在或不可用');
    }
    if (inviter.id === userId) {
      throw new BadRequestException('不能使用自己的邀请码');
    }
    await tx.user.update({
      where: { id: userId },
      data: { inviterId: inviter.id },
    });
    return inviter.id;
  }

  async myOverview(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        points: true,
        inviteCode: true,
        inviter: { select: { id: true, username: true, nickname: true } },
        _count: { select: { invitees: true } },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const inviteCode = user.inviteCode || (await this.ensureInviteCode(userId));

    const [effectiveInviteCount, inviteRewardAgg, recentInvitees] = await this.prisma.$transaction([
      this.prisma.pointLog.count({
        where: { userId, type: 'INVITE_REWARD' },
      }),
      this.prisma.pointLog.aggregate({
        where: { userId, type: 'INVITE_REWARD' },
        _sum: { amount: true },
      }),
      this.prisma.user.findMany({
        where: { inviterId: userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          username: true,
          nickname: true,
          createdAt: true,
          inviteRewardedAt: true,
        },
      }),
    ]);

    return {
      points: user.points,
      inviteCode,
      inviteUrlPath: `/register?invite=${encodeURIComponent(inviteCode)}`,
      inviter: user.inviter,
      inviteCount: user._count.invitees,
      effectiveInviteCount,
      inviteRewardPoints: inviteRewardAgg._sum.amount ?? 0,
      recentInvitees,
      rules: {
        orderRewardRate: POINT_REWARD_RATE,
        inviteRewardRate: POINT_REWARD_RATE,
        pointValue: 1,
      },
    };
  }

  async myLogs(userId: number, page = 1, pageSize = 30) {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.pointLog.count({ where: { userId } }),
      this.prisma.pointLog.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async adminLogs(page = 1, pageSize = 50, userId?: number, type?: string) {
    const where: Prisma.PointLogWhereInput = {
      ...(userId ? { userId } : {}),
      ...(type ? { type: type as any } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.pointLog.count({ where }),
      this.prisma.pointLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, username: true, nickname: true } } },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async adminAdjust(userId: number, amount: number, note?: string) {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException('积分调整数量必须是非零整数');
    }
    if (Math.abs(amount) > 1_000_000) {
      throw new BadRequestException('单次调整积分超过上限');
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, points: true },
      });
      if (!user) throw new NotFoundException('用户不存在');
      if (user.points + amount < 0) {
        throw new BadRequestException('调整后积分不能为负数');
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { points: { increment: amount } },
        select: { points: true },
      });
      await tx.pointLog.create({
        data: {
          userId,
          amount,
          balance: updated.points,
          type: 'ADMIN_ADJUST',
          note: note?.slice(0, 191),
        },
      });
      return { points: updated.points };
    });
  }

  async deductForOrder(tx: Tx, userId: number, orderNo: string, points: number) {
    if (!Number.isInteger(points) || points <= 0) {
      throw new BadRequestException('积分支付金额非法');
    }
    const r = await tx.user.updateMany({
      where: { id: userId, points: { gte: points } },
      data: { points: { decrement: points } },
    });
    if (r.count === 0) throw new BadRequestException('积分不足');

    const after = await tx.user.findUnique({
      where: { id: userId },
      select: { points: true },
    });
    await tx.pointLog.create({
      data: {
        userId,
        amount: -points,
        balance: after?.points ?? 0,
        type: 'ORDER_DEDUCT',
        note: `积分支付订单 ${orderNo}`,
        refOrder: orderNo,
      },
    });
  }

  private async awardOnce(
    tx: Tx,
    userId: number,
    amount: number,
    type: 'ORDER_REWARD' | 'INVITE_REWARD' | 'ORDER_REFUND',
    refOrder: string,
    note: string,
  ) {
    if (!Number.isInteger(amount) || amount <= 0) return false;
    try {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { points: { increment: amount } },
        select: { points: true },
      });
      await tx.pointLog.create({
        data: {
          userId,
          amount,
          balance: updated.points,
          type,
          refOrder,
          note: note.slice(0, 191),
        },
      });
      return true;
    } catch (e: any) {
      if (e?.code === 'P2002') return false;
      throw e;
    }
  }

  async settleDeliveredLocalOrder(tx: Tx, orderNo: string) {
    const order = await tx.order.findUnique({
      where: { orderNo },
      select: {
        orderNo: true,
        userId: true,
        payAmount: true,
        payMethod: true,
        status: true,
        product: { select: { pointsAwardEnabled: true, pointsAwardRate: true } },
      },
    });
    if (!order?.userId || order.status !== 'DELIVERED') return;
    // 商品维度关闭返积分 → 消费返积分 / 邀请首单奖励都跳过
    if (!order.product?.pointsAwardEnabled) return;

    const reward = this.rewardForAmount(
      Number(order.payAmount),
      order.product.pointsAwardRate,
    );
    if (reward > 0 && order.payMethod !== 'POINTS') {
      await this.awardOnce(
        tx,
        order.userId,
        reward,
        'ORDER_REWARD',
        order.orderNo,
        `订单 ${order.orderNo} 消费返积分`,
      );
    }

    const invitee = await tx.user.findUnique({
      where: { id: order.userId },
      select: { inviterId: true, inviteRewardedAt: true },
    });
    if (!invitee?.inviterId || invitee.inviteRewardedAt || reward <= 0) return;

    const marked = await tx.user.updateMany({
      where: { id: order.userId, inviterId: invitee.inviterId, inviteRewardedAt: null },
      data: { inviteRewardedAt: new Date() },
    });
    if (marked.count === 0) return;

    await this.awardOnce(
      tx,
      invitee.inviterId,
      reward,
      'INVITE_REWARD',
      order.orderNo,
      `邀请用户首单 ${order.orderNo} 返积分`,
    );
  }

  async settleDeliveredForgeOrder(tx: Tx, orderNo: string) {
    const order = await tx.forgeOrder.findUnique({
      where: { orderNo },
      select: {
        orderNo: true,
        userId: true,
        payAmount: true,
        totalAmount: true,
        paymentMethod: true,
        status: true,
        product: { select: { pointsAwardEnabled: true, pointsAwardRate: true } },
      },
    });
    if (!order?.userId || order.status !== 'DELIVERED') return;
    // 商品维度关闭返积分 → 消费返积分 / 邀请首单奖励都跳过
    if (!order.product?.pointsAwardEnabled) return;

    const paidAmount = order.payAmount !== null
      ? Number(order.payAmount)
      : Number(order.totalAmount);
    const reward = this.rewardForAmount(paidAmount, order.product.pointsAwardRate);
    if (reward <= 0) return;

    if (order.paymentMethod !== 'POINTS') {
      await this.awardOnce(
        tx,
        order.userId,
        reward,
        'ORDER_REWARD',
        order.orderNo,
        `三方订单 ${order.orderNo} 消费返积分`,
      );
    }

    const invitee = await tx.user.findUnique({
      where: { id: order.userId },
      select: { inviterId: true, inviteRewardedAt: true },
    });
    if (!invitee?.inviterId || invitee.inviteRewardedAt) return;

    const marked = await tx.user.updateMany({
      where: { id: order.userId, inviterId: invitee.inviterId, inviteRewardedAt: null },
      data: { inviteRewardedAt: new Date() },
    });
    if (marked.count === 0) return;

    await this.awardOnce(
      tx,
      invitee.inviterId,
      reward,
      'INVITE_REWARD',
      order.orderNo,
      `邀请用户三方首单 ${order.orderNo} 返积分`,
    );
  }

  async settleDeliveredForgeQuotaOrder(tx: Tx, orderNo: string) {
    const order = await tx.forgeQuotaOrder.findUnique({
      where: { orderNo },
      select: {
        orderNo: true,
        userId: true,
        payAmount: true,
        totalAmount: true,
        paymentMethod: true,
        status: true,
        package: { select: { pointsAwardEnabled: true, pointsAwardRate: true } },
      },
    });
    if (!order?.userId || order.status !== 'DELIVERED') return;
    if (!order.package?.pointsAwardEnabled) return;

    const paidAmount = order.payAmount !== null
      ? Number(order.payAmount)
      : Number(order.totalAmount);
    const reward = this.rewardForAmount(paidAmount, order.package.pointsAwardRate);
    if (reward <= 0) return;

    if (order.paymentMethod !== 'POINTS') {
      await this.awardOnce(
        tx,
        order.userId,
        reward,
        'ORDER_REWARD',
        order.orderNo,
        `额度包订单 ${order.orderNo} 消费返积分`,
      );
    }

    const invitee = await tx.user.findUnique({
      where: { id: order.userId },
      select: { inviterId: true, inviteRewardedAt: true },
    });
    if (!invitee?.inviterId || invitee.inviteRewardedAt) return;

    const marked = await tx.user.updateMany({
      where: { id: order.userId, inviterId: invitee.inviterId, inviteRewardedAt: null },
      data: { inviteRewardedAt: new Date() },
    });
    if (marked.count === 0) return;

    await this.awardOnce(
      tx,
      invitee.inviterId,
      reward,
      'INVITE_REWARD',
      order.orderNo,
      `邀请用户额度包首单 ${order.orderNo} 返积分`,
    );
  }

  async refundDeductedPoints(tx: Tx, userId: number, orderNo: string, points: number) {
    if (!Number.isInteger(points) || points <= 0) return false;
    return this.awardOnce(
      tx,
      userId,
      points,
      'ORDER_REFUND',
      orderNo,
      `积分支付退款 ${orderNo}`,
    );
  }
}
