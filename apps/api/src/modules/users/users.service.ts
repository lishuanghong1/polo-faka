import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u) throw new Error('用户不存在');
      const newBalance = +(Number(u.balance) + amount).toFixed(2);
      await tx.user.update({ where: { id: userId }, data: { balance: newBalance } });
      await tx.balanceLog.create({
        data: {
          userId,
          amount: new Prisma.Decimal(amount),
          balance: newBalance,
          type: 'ADJUST',
          note,
        },
      });
      return newBalance;
    });
  }

  update(id: number, data: any) {
    delete data.password;
    return this.prisma.user.update({ where: { id }, data });
  }
}
