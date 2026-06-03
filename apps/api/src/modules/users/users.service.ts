import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 允许 ADMIN 通过 PUT /users/:id 修改的字段白名单。
 * 任何不在白名单内的字段都会被丢弃；balance 必须走 /adjust-balance（带审计 + 流水）。
 */
const UPDATABLE_FIELDS = new Set([
  'email',
  'nickname',
  'avatar',
  'status',
  'role',
  'password',
]);

const ALLOWED_STATUSES = new Set(['ACTIVE', 'BANNED']);
const ALLOWED_ROLES = new Set(['USER', 'ADMIN']);

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list(page = 1, pageSize = 20, keyword?: string) {
    const kw = (keyword || '').trim();
    const where: Prisma.UserWhereInput = kw
      ? {
          OR: [
            // 数字关键字按 id 精确匹配，避免输入 "5" 匹配出所有含 5 的用户名
            ...(/^\d+$/.test(kw) ? [{ id: Number(kw) }] : []),
            { username: { contains: kw } },
            { email: { contains: kw } },
            { nickname: { contains: kw } },
          ],
        }
      : {};
    return this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          username: true,
          email: true,
          nickname: true,
          balance: true,
          totalRecharged: true,
          vipTier: true,
          role: true,
          status: true,
          createdAt: true,
          lastLogin: true,
        },
      }),
    ]).then(([total, items]) => ({ total, page, pageSize, items }));
  }

  /**
   * 管理员查看单个用户详情：基础信息 + 钱包 + 最近 30 笔充值 + 最近 50 条流水 + 最近 20 笔订单
   * 用于后台从用户视角自检"客户充值是否真的入账"
   */
  async detail(id: number) {
    if (!id || !Number.isInteger(id)) throw new BadRequestException('用户 id 非法');
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        avatar: true,
        role: true,
        status: true,
        balance: true,
        totalRecharged: true,
        vipTier: true,
        vipUpgradedAt: true,
        createdAt: true,
        lastLogin: true,
      },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const [rechargeOrders, balanceLogs, orders, forgeOrders, rechargeAgg] =
      await this.prisma.$transaction([
        this.prisma.rechargeOrder.findMany({
          where: { userId: id },
          orderBy: { id: 'desc' },
          take: 30,
          select: {
            orderNo: true,
            amount: true,
            status: true,
            payMethod: true,
            thirdTradeNo: true,
            buyerLogonId: true,
            paidAt: true,
            expireAt: true,
            createdAt: true,
          },
        }),
        this.prisma.balanceLog.findMany({
          where: { userId: id },
          orderBy: { id: 'desc' },
          take: 50,
          select: {
            id: true,
            amount: true,
            balance: true,
            type: true,
            note: true,
            refOrder: true,
            createdAt: true,
          },
        }),
        this.prisma.order.findMany({
          where: { userId: id },
          orderBy: { id: 'desc' },
          take: 20,
          select: {
            orderNo: true,
            productTitle: true,
            skuName: true,
            quantity: true,
            payAmount: true,
            payMethod: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.forgeOrder.findMany({
          where: { userId: id },
          orderBy: { id: 'desc' },
          take: 20,
          select: {
            orderNo: true,
            typeName: true,
            quantity: true,
            payAmount: true,
            totalAmount: true,
            paymentMethod: true,
            status: true,
            createdAt: true,
          },
        }),
        // 已确认入账（PAID）的充值总和，用于和 totalRecharged 交叉验证
        this.prisma.rechargeOrder.aggregate({
          where: { userId: id, status: 'PAID' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]);

    return {
      user,
      wallet: {
        balance: Number(user.balance),
        totalRecharged: Number(user.totalRecharged),
        vipTier: user.vipTier,
        vipUpgradedAt: user.vipUpgradedAt,
        paidRechargeCount: rechargeAgg._count._all,
        paidRechargeSum: Number(rechargeAgg._sum.amount ?? 0),
      },
      rechargeOrders: rechargeOrders.map((o) => ({
        ...o,
        amount: Number(o.amount),
      })),
      balanceLogs: balanceLogs.map((l) => ({
        ...l,
        amount: Number(l.amount),
        balance: Number(l.balance),
      })),
      orders: orders.map((o) => ({
        ...o,
        payAmount: Number(o.payAmount),
        kind: 'LOCAL' as const,
      })),
      forgeOrders: forgeOrders.map((o) => ({
        ...o,
        payAmount: o.payAmount !== null ? Number(o.payAmount) : null,
        totalAmount: Number(o.totalAmount),
        kind: 'FORGE' as const,
      })),
    };
  }

  myBalanceLogs(userId: number, page = 1, pageSize = 30) {
    if (!userId || typeof userId !== 'number') {
      throw new Error('未登录');
    }
    return this.prisma.balanceLog.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async adjustBalance(userId: number, amount: number, note?: string) {
    if (!Number.isFinite(amount) || amount === 0) {
      throw new BadRequestException('amount 必须是非零有限数');
    }
    if (Math.abs(amount) > 1_000_000) {
      throw new BadRequestException('单次调整金额超过上限（¥1,000,000）');
    }
    const safeAmount = Math.round(amount * 100) / 100;
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!exists) throw new NotFoundException('用户不存在');

      if (safeAmount < 0) {
        // 扣减：CAS 守卫，避免并发把余额扣成负数
        const need = new Prisma.Decimal(-safeAmount);
        const r = await tx.user.updateMany({
          where: { id: userId, balance: { gte: need } },
          data: { balance: { decrement: need } },
        });
        if (r.count === 0) {
          throw new BadRequestException('调整后余额会变成负数，已拒绝');
        }
      } else {
        // 加余额：原子 increment 杜绝 lost-update
        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: new Prisma.Decimal(safeAmount) } },
        });
      }

      const after = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });
      const newBalance = Number(after?.balance ?? 0);
      await tx.balanceLog.create({
        data: {
          userId,
          amount: new Prisma.Decimal(safeAmount),
          balance: new Prisma.Decimal(newBalance),
          type: 'ADJUST',
          note: note?.slice(0, 255),
        },
      });
      return newBalance;
    });
  }

  /**
   * 管理员更新指定用户。
   * - 仅允许白名单字段
   * - balance 必须走 adjustBalance（强制写流水）
   * - role / status 不允许对自己生效（防止把自己 demote / 封禁锁死系统）
   * - 改密码会重新做 argon2 哈希
   */
  async update(id: number, data: any, actorUserId?: number) {
    if (!id || !Number.isInteger(id)) throw new BadRequestException('用户 id 非法');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('用户不存在');

    const clean: Prisma.UserUpdateInput = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (!UPDATABLE_FIELDS.has(k)) continue;
      if (k === 'role') {
        if (typeof v !== 'string' || !ALLOWED_ROLES.has(v)) {
          throw new BadRequestException('role 只能为 USER / ADMIN');
        }
        if (actorUserId && actorUserId === id) {
          throw new ForbiddenException('不能修改自己的角色');
        }
        (clean as any).role = v;
      } else if (k === 'status') {
        if (typeof v !== 'string' || !ALLOWED_STATUSES.has(v)) {
          throw new BadRequestException('status 只能为 ACTIVE / BANNED');
        }
        if (actorUserId && actorUserId === id && v === 'BANNED') {
          throw new ForbiddenException('不能封禁自己');
        }
        (clean as any).status = v;
      } else if (k === 'password') {
        if (typeof v !== 'string' || v.length < 6 || v.length > 64) {
          throw new BadRequestException('密码长度 6-64');
        }
        (clean as any).password = await argon2.hash(v);
      } else if (k === 'email') {
        if (v !== null && typeof v !== 'string') {
          throw new BadRequestException('email 非法');
        }
        (clean as any).email = v || null;
      } else if (k === 'nickname' || k === 'avatar') {
        if (v !== null && typeof v !== 'string') continue;
        (clean as any)[k] = v;
      }
    }
    if (Object.keys(clean).length === 0) {
      throw new BadRequestException('没有可更新的字段');
    }
    return this.prisma.user.update({
      where: { id },
      data: clean,
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        avatar: true,
        role: true,
        status: true,
        balance: true,
      },
    });
  }
}
