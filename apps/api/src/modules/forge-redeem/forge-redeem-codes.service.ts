import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import dayjs from 'dayjs';
import { Prisma, ForgeRedeemStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateForgeCodesDto } from './dto';

const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const codeNano = customAlphabet(codeAlphabet, 16);

function makeRedeemCode(prefix = 'FK'): string {
  // FK-XXXX-XXXX-XXXX-XXXX
  const raw = codeNano();
  return `${prefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

@Injectable()
export class ForgeRedeemCodesService {
  constructor(private prisma: PrismaService) {}

  async generate(dto: GenerateForgeCodesDto) {
    const batchTag = `FB${dayjs().format('YYYYMMDDHHmmss')}-${codeNano().slice(0, 6)}`;
    const expireAt = dto.expireAt ? new Date(dto.expireAt) : null;
    const codes: string[] = [];
    while (codes.length < dto.count) {
      const need = dto.count - codes.length;
      const candidates = Array.from({ length: need }, () => makeRedeemCode(dto.prefix || 'FK'));
      await this.prisma.forgeRedeemCode.createMany({
        data: candidates.map((code) => ({
          code,
          totalAmount: new Prisma.Decimal(dto.totalAmount),
          expireAt,
          batchTag,
          note: dto.note,
        })),
        skipDuplicates: true,
      });
      const written = await this.prisma.forgeRedeemCode.findMany({
        where: { batchTag, code: { in: candidates } },
        select: { code: true },
      });
      codes.push(...written.map((w) => w.code));
    }
    return { batchTag, count: codes.length, codes };
  }

  async list(query: {
    page?: number;
    pageSize?: number;
    status?: string;
    batchTag?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const where: Prisma.ForgeRedeemCodeWhereInput = {};
    if (query.status) where.status = query.status as ForgeRedeemStatus;
    if (query.batchTag) where.batchTag = query.batchTag;
    if (query.keyword) where.code = { contains: query.keyword };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.forgeRedeemCode.count({ where }),
      this.prisma.forgeRedeemCode.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((it) => ({
        ...it,
        totalAmount: Number(it.totalAmount),
        usedAmount: Number(it.usedAmount),
      })),
    };
  }

  async batches(limit = 50) {
    const rows = await this.prisma.forgeRedeemCode.groupBy({
      by: ['batchTag'],
      _count: { _all: true },
      _max: { createdAt: true },
      where: { batchTag: { not: null } },
      orderBy: { _max: { createdAt: 'desc' } },
      take: limit,
    });
    return rows.map((r) => ({
      batchTag: r.batchTag,
      count: r._count._all,
      createdAt: r._max.createdAt,
    }));
  }

  async getBatch(batchTag: string) {
    const items = await this.prisma.forgeRedeemCode.findMany({
      where: { batchTag },
      orderBy: { id: 'asc' },
      select: { code: true, status: true, totalAmount: true, usedAmount: true },
    });
    return { batchTag, count: items.length, items };
  }

  async toggleStatus(id: number, status: 'ACTIVE' | 'DISABLED') {
    if (!['ACTIVE', 'DISABLED'].includes(status)) {
      throw new BadRequestException('状态不合法');
    }
    return this.prisma.forgeRedeemCode.update({
      where: { id },
      data: { status: status as ForgeRedeemStatus },
    });
  }

  async remove(id: number) {
    const r = await this.prisma.forgeRedeemCode.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('兑换码不存在');
    if (Number(r.usedAmount) > 0) {
      throw new BadRequestException('已使用过的码不能删除，请改为禁用');
    }
    await this.prisma.forgeRedeemCode.delete({ where: { id } });
    return { ok: true };
  }

  /** 查询单个码状态（不消耗）+ 历史订单 */
  async info(rawCode: string) {
    const code = await this.prisma.forgeRedeemCode.findUnique({
      where: { code: (rawCode || '').trim() },
      include: {
        orders: {
          orderBy: { id: 'desc' },
          take: 50,
          select: {
            orderNo: true,
            typeName: true,
            typeKey: true,
            quantity: true,
            totalAmount: true,
            status: true,
            createdAt: true,
            deliveredAt: true,
          },
        },
      },
    });
    if (!code) throw new NotFoundException('兑换码不存在');

    if (
      code.status === 'ACTIVE' &&
      code.expireAt &&
      code.expireAt.getTime() < Date.now()
    ) {
      await this.prisma.forgeRedeemCode.update({
        where: { id: code.id },
        data: { status: 'EXPIRED' },
      });
      code.status = 'EXPIRED';
    }

    const remaining = Math.max(0, Number(code.totalAmount) - Number(code.usedAmount));

    return {
      code: code.code,
      status: code.status,
      totalAmount: Number(code.totalAmount),
      usedAmount: Number(code.usedAmount),
      remaining,
      expireAt: code.expireAt,
      note: code.note,
      orders: code.orders.map((o) => ({
        ...o,
        totalAmount: Number(o.totalAmount),
      })),
    };
  }
}
