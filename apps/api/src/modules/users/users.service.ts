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
    const where = keyword
      ? {
          OR: [
            { username: { contains: keyword } },
            { email: { contains: keyword } },
            { nickname: { contains: keyword } },
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
          role: true,
          status: true,
          createdAt: true,
          lastLogin: true,
        },
      }),
    ]).then(([total, items]) => ({ total, page, pageSize, items }));
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
    // 保留 2 位小数，避免浮点尾巴
    const safeAmount = Math.round(amount * 100) / 100;
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u) throw new NotFoundException('用户不存在');
      const newBalance = +(Number(u.balance) + safeAmount).toFixed(2);
      if (newBalance < 0) {
        throw new BadRequestException(`调整后余额会变成负数（${newBalance}），已拒绝`);
      }
      await tx.user.update({ where: { id: userId }, data: { balance: newBalance } });
      await tx.balanceLog.create({
        data: {
          userId,
          amount: new Prisma.Decimal(safeAmount),
          balance: newBalance,
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
