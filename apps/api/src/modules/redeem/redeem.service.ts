import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import dayjs from 'dayjs';
import { Prisma, RedeemCodeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';

/** 兑换码字符集：去掉容易混淆的 0/O/1/I/l */
const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const codeNano = customAlphabet(codeAlphabet, 16);

function makeCode(prefix = 'RD'): string {
  // RD-AAAAAAAA-AAAAAAAA
  const raw = codeNano();
  return `${prefix}-${raw.slice(0, 8)}-${raw.slice(8, 16)}`;
}

export interface GenerateInput {
  productId: number;
  skuId: number;
  count: number;
  qtyPerUse?: number;
  maxUses?: number;
  expireAt?: string | null;
  note?: string;
  prefix?: string;
}

@Injectable()
export class RedeemService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => OrdersService)) private orders: OrdersService,
  ) {}

  // ─────────────────────────── Admin ───────────────────────────

  /** 批量生成兑换码 */
  async generate(input: GenerateInput) {
    if (!Number.isInteger(input.count) || input.count <= 0 || input.count > 5000) {
      throw new BadRequestException('单次最多生成 5000 个');
    }
    const sku = await this.prisma.sku.findUnique({
      where: { id: input.skuId },
      include: { product: true },
    });
    if (!sku || sku.productId !== input.productId) {
      throw new NotFoundException('商品规格不存在');
    }

    const batchTag = `B${dayjs().format('YYYYMMDDHHmmss')}-${codeNano().slice(0, 6)}`;
    const qtyPerUse = input.qtyPerUse && input.qtyPerUse > 0 ? input.qtyPerUse : 1;
    const maxUses = input.maxUses && input.maxUses > 0 ? input.maxUses : 1;
    const expireAt = input.expireAt ? new Date(input.expireAt) : null;
    const codes: string[] = [];
    // 重试若干次防唯一冲突
    while (codes.length < input.count) {
      const need = input.count - codes.length;
      const candidates = Array.from({ length: need }, () => makeCode(input.prefix));
      // 一次性插入
      try {
        await this.prisma.redeemCode.createMany({
          data: candidates.map((code) => ({
            code,
            productId: input.productId,
            skuId: input.skuId,
            qtyPerUse,
            maxUses,
            expireAt,
            note: input.note,
            batchTag,
          })),
          skipDuplicates: true,
        });
        // 查回真正写入的
        const written = await this.prisma.redeemCode.findMany({
          where: { batchTag, code: { in: candidates } },
          select: { code: true },
        });
        codes.push(...written.map((w) => w.code));
      } catch {
        // 撞 unique 也再试
      }
    }
    return {
      batchTag,
      count: codes.length,
      product: sku.product.title,
      sku: sku.name,
      codes,
    };
  }

  async list(query: {
    page?: number;
    pageSize?: number;
    status?: string;
    batchTag?: string;
    skuId?: number;
    keyword?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const where: Prisma.RedeemCodeWhereInput = {};
    if (query.status) where.status = query.status as RedeemCodeStatus;
    if (query.batchTag) where.batchTag = query.batchTag;
    if (query.skuId) where.skuId = query.skuId;
    if (query.keyword) where.code = { contains: query.keyword };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.redeemCode.count({ where }),
      this.prisma.redeemCode.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { records: true } },
        },
      }),
    ]);

    // 取出 SKU/Product 名称
    const skuIds = Array.from(new Set(items.map((i) => i.skuId)));
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: skuIds } },
      include: { product: { select: { title: true } } },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));

    return {
      total,
      page,
      pageSize,
      items: items.map((it) => {
        const sku = skuMap.get(it.skuId);
        return {
          ...it,
          productTitle: sku?.product?.title ?? '',
          skuName: sku?.name ?? '',
        };
      }),
    };
  }

  async overview() {
    const groups = await this.prisma.redeemCode.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const obj: Record<string, number> = {
      ACTIVE: 0,
      DISABLED: 0,
      EXHAUSTED: 0,
      EXPIRED: 0,
    };
    for (const g of groups) obj[g.status] = g._count._all;
    obj.total = obj.ACTIVE + obj.DISABLED + obj.EXHAUSTED + obj.EXPIRED;
    return obj;
  }

  async batches(limit = 50) {
    const rows = await this.prisma.redeemCode.groupBy({
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
    const items = await this.prisma.redeemCode.findMany({
      where: { batchTag },
      orderBy: { id: 'asc' },
      select: { code: true, status: true, usedCount: true, maxUses: true },
    });
    return { batchTag, count: items.length, items };
  }

  async toggleStatus(id: number, status: 'ACTIVE' | 'DISABLED') {
    if (!['ACTIVE', 'DISABLED'].includes(status)) {
      throw new BadRequestException('状态不合法');
    }
    return this.prisma.redeemCode.update({
      where: { id },
      data: { status: status as RedeemCodeStatus },
    });
  }

  async batchToggleStatus(ids: number[], status: 'ACTIVE' | 'DISABLED') {
    if (!ids?.length) throw new BadRequestException('未选择');
    return this.prisma.redeemCode.updateMany({
      where: { id: { in: ids } },
      data: { status: status as RedeemCodeStatus },
    });
  }

  async remove(id: number) {
    const r = await this.prisma.redeemCode.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('兑换码不存在');
    if (r.usedCount > 0) {
      throw new BadRequestException('已被兑换过的码不能删除，请改为禁用');
    }
    await this.prisma.redeemCode.delete({ where: { id } });
    return { ok: true };
  }

  async batchRemove(ids: number[]) {
    if (!ids?.length) return { deleted: 0 };
    const result = await this.prisma.redeemCode.deleteMany({
      where: { id: { in: ids }, usedCount: 0 },
    });
    return { deleted: result.count };
  }

  // ─────────────────────────── 客户兑换 ───────────────────────────

  /** 查询单个码状态（不消耗）+ 历史兑换订单 */
  async info(rawCode: string) {
    const code = await this.prisma.redeemCode.findUnique({
      where: { code: rawCode.trim().toUpperCase() },
    });
    if (!code) throw new NotFoundException('兑换码不存在');
    const sku = await this.prisma.sku.findUnique({
      where: { id: code.skuId },
      include: { product: { select: { title: true, cover: true } } },
    });

    // 历史兑换订单（按 RedeemRecord 关联 orderNo 查 Order）
    // 注：RedeemRecord 与 Order 之间没有 schema relation，用 orderNo 字符串关联即可
    const records = await this.prisma.redeemRecord.findMany({
      where: { codeId: code.id },
      orderBy: { id: 'desc' },
      take: 50,
      select: { orderNo: true, createdAt: true },
    });
    const orderNos = records.map((r) => r.orderNo);
    const orderRows = orderNos.length
      ? await this.prisma.order.findMany({
          where: { orderNo: { in: orderNos } },
          select: {
            orderNo: true,
            productTitle: true,
            skuName: true,
            quantity: true,
            totalAmount: true,
            payMethod: true,
            status: true,
            contact: true,
            createdAt: true,
            deliveredAt: true,
          },
        })
      : [];
    const orderMap = new Map(orderRows.map((o) => [o.orderNo, o]));
    // 按 records 顺序对齐；列表里不下发 contact，只用作前端判断要不要带 contact 跳转
    const orders = records
      .map((r) => {
        const o = orderMap.get(r.orderNo);
        if (!o) return null;
        return {
          orderNo: o.orderNo,
          productTitle: o.productTitle,
          skuName: o.skuName,
          quantity: o.quantity,
          totalAmount: Number(o.totalAmount),
          payMethod: o.payMethod,
          status: o.status,
          hasContact: !!o.contact,
          createdAt: o.createdAt,
          deliveredAt: o.deliveredAt,
          redeemedAt: r.createdAt,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      code: code.code,
      status: code.status,
      qtyPerUse: code.qtyPerUse,
      maxUses: code.maxUses,
      usedCount: code.usedCount,
      remaining: Math.max(0, code.maxUses - code.usedCount),
      expireAt: code.expireAt,
      productTitle: sku?.product?.title ?? '',
      productCover: sku?.product?.cover ?? '',
      skuName: sku?.name ?? '',
      orders,
    };
  }

  /** 客户兑换：消耗 1 次使用次数，生成 PAID 订单并发货 */
  async redeem(input: {
    code: string;
    contact?: string;
    userId?: number | null;
    ip?: string;
    userAgent?: string;
  }) {
    const rawCode = input.code?.trim().toUpperCase();
    if (!rawCode) throw new BadRequestException('请填写兑换码');

    // 用事务 + select for update 防并发超用
    const reservedId = await this.prisma.$transaction(async (tx) => {
      const code = await tx.redeemCode.findUnique({ where: { code: rawCode } });
      if (!code) throw new NotFoundException('兑换码不存在');
      if (code.status === 'DISABLED') {
        throw new BadRequestException('该兑换码已被禁用');
      }
      if (code.status === 'EXHAUSTED' || code.usedCount >= code.maxUses) {
        throw new BadRequestException('该兑换码已用完');
      }
      if (code.expireAt && code.expireAt.getTime() < Date.now()) {
        await tx.redeemCode.update({
          where: { id: code.id },
          data: { status: 'EXPIRED' },
        });
        throw new BadRequestException('该兑换码已过期');
      }
      // 乐观锁：基于 usedCount 自增（更新行数为 0 表示并发抢走）
      const next = code.usedCount + 1;
      const updated = await tx.redeemCode.updateMany({
        where: {
          id: code.id,
          usedCount: code.usedCount,
          status: 'ACTIVE',
        },
        data: {
          usedCount: next,
          status: next >= code.maxUses ? 'EXHAUSTED' : 'ACTIVE',
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException('兑换繁忙，请重试');
      }
      return code.id;
    });

    // 拿 SKU 信息生成订单
    const code = await this.prisma.redeemCode.findUnique({
      where: { id: reservedId },
    });
    if (!code) throw new NotFoundException('兑换码不存在');
    const sku = await this.prisma.sku.findUnique({
      where: { id: code.skuId },
      include: { product: true },
    });
    if (!sku) {
      // 回滚使用次数
      await this.rollbackUsage(reservedId);
      throw new NotFoundException('商品不存在');
    }

    const orderNo = this.makeOrderNo();
    const order = await this.prisma.order.create({
      data: {
        orderNo,
        userId: input.userId ?? null,
        productId: sku.productId,
        skuId: sku.id,
        productTitle: sku.product.title,
        skuName: sku.name,
        unitPrice: 0,
        quantity: code.qtyPerUse,
        totalAmount: 0,
        payAmount: 0,
        payMethod: 'REDEEM',
        status: 'PAID',
        paidAt: new Date(),
        contact: input.contact,
        remark: `兑换码 ${code.code}`,
        ip: input.ip,
        expireAt: dayjs().add(1, 'day').toDate(),
      },
    });

    // 记录使用
    await this.prisma.redeemRecord.create({
      data: {
        codeId: code.id,
        orderNo: order.orderNo,
        userId: input.userId ?? null,
        contact: input.contact,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 500),
      },
    });

    // 复用订单发货逻辑
    try {
      await this.orders.markPaidAndDeliver(order.orderNo);
    } catch (e) {
      // 库存不足等，订单状态会保持 PAID（卡密未发齐），不回滚兑换次数（避免重复使用同一码套出多张）
      // admin 可以手动补发或退兑换次数
      throw e;
    }

    return this.orders.detail(order.orderNo);
  }

  private async rollbackUsage(codeId: number) {
    await this.prisma.redeemCode
      .update({
        where: { id: codeId },
        data: {
          usedCount: { decrement: 1 },
          status: 'ACTIVE',
        },
      })
      .catch(() => null);
  }

  private makeOrderNo() {
    return `R${dayjs().format('YYYYMMDDHHmmss')}${codeNano().slice(0, 12)}`;
  }
}
