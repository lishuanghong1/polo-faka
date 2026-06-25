import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface ListQuery {
  categoryId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async list(q: ListQuery) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 50));
    const where: any = { status: 'ON_SALE' };
    if (q.categoryId) where.categoryId = Number(q.categoryId);
    if (q.keyword) where.title = { contains: q.keyword };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ sort: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          skus: {
            where: { visible: true },
            orderBy: { sort: 'asc' },
          },
        },
      }),
    ]);

    const poolStock = items.some((p) => p.deliveryType === 'POOL_QUOTA')
      ? await this.computePoolAvailableAccounts()
      : 0;
    const list = await Promise.all(
      items.map(async (p) => {
        const stockBySku =
          p.deliveryType === 'POOL_QUOTA' ? {} : await this.computeStockBySku(p.id);
        // CARD_KEY 看 CardKey AVAILABLE；POOL_QUOTA 看当前可申请的号池账号数
        const skus = p.skus.map((s) => ({
          ...s,
          stock: p.deliveryType === 'POOL_QUOTA' ? poolStock : stockBySku[s.id] ?? 0,
        }));
        const totalStock = skus.reduce((a, b) => a + (b.stock || 0), 0);
        return { ...p, skus, totalStock };
      }),
    );

    return { total, page, pageSize, items: list };
  }

  /** 管理员列表：返回所有状态（在售 / 下架 / 草稿）和全部 SKU（含隐藏），带真实库存 */
  async adminList(q: { status?: string; keyword?: string; categoryId?: number } = {}) {
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.categoryId) where.categoryId = Number(q.categoryId);
    if (q.keyword) where.title = { contains: q.keyword };

    const items = await this.prisma.product.findMany({
      where,
      orderBy: [{ sort: 'desc' }, { id: 'desc' }],
      include: {
        category: { select: { id: true, name: true, slug: true } },
        skus: { orderBy: { sort: 'asc' } },
      },
    });

    const poolStock = items.some((p) => p.deliveryType === 'POOL_QUOTA')
      ? await this.computePoolAvailableAccounts()
      : 0;
    const list = await Promise.all(
      items.map(async (p) => {
        const stockBySku =
          p.deliveryType === 'POOL_QUOTA' ? {} : await this.computeStockBySku(p.id);
        const skus = p.skus.map((s) => ({
          ...s,
          stock: p.deliveryType === 'POOL_QUOTA' ? poolStock : stockBySku[s.id] ?? 0,
        }));
        const totalStock = skus.reduce((a, b) => a + (b.stock || 0), 0);
        return { ...p, skus, totalStock };
      }),
    );

    return { total: list.length, items: list };
  }

  async detail(id: number) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        skus: { where: { visible: true }, orderBy: { sort: 'asc' } },
      },
    });
    if (!p) throw new NotFoundException('商品不存在');
    const poolStock =
      p.deliveryType === 'POOL_QUOTA' ? await this.computePoolAvailableAccounts() : 0;
    const stockBySku = p.deliveryType === 'POOL_QUOTA' ? {} : await this.computeStockBySku(p.id);
    return {
      ...p,
      skus: p.skus.map((s) => ({
        ...s,
        stock: p.deliveryType === 'POOL_QUOTA' ? poolStock : stockBySku[s.id] ?? 0,
      })),
    };
  }

  /** 按 SKU 统计 AVAILABLE 的卡密数作为真实库存 */
  async computeStockBySku(productId: number): Promise<Record<number, number>> {
    const rows = await this.prisma.cardKey.groupBy({
      by: ['skuId'],
      where: { productId, status: 'AVAILABLE' },
      _count: { _all: true },
    });
    const result: Record<number, number> = {};
    for (const r of rows) result[r.skuId] = r._count._all;
    return result;
  }

  /** 当前可新分配给用户的号池账号数量 */
  async computePoolAvailableAccounts() {
    const rows = await this.prisma.poolAccount.findMany({
      where: {
        status: { in: ['HEALTHY', 'LOW_QUOTA', 'UNKNOWN'] as any },
        grants: { none: { active: true } },
      },
      select: { id: true },
    });
    return rows.length;
  }

  // ====== Admin ======
  /**
   * 把前端传来的 pointsAwardRate 规整为 Decimal | null：
   * - 空串 / null / undefined / NaN → null（走全局默认 10%）
   * - 数字会被夹到 [0, 1] 范围
   */
  private normalizePointsAwardRate(raw: any): any {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '' ) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(1, n));
  }

  create(data: any) {
    const { skus = [], ...rest } = data;
    const rate = this.normalizePointsAwardRate(rest.pointsAwardRate);
    if (rate !== undefined) rest.pointsAwardRate = rate;
    return this.prisma.product.create({
      data: {
        ...rest,
        skus: skus.length ? { create: skus } : undefined,
      },
      include: { skus: true },
    });
  }

  async update(id: number, data: any) {
    const { skus, ...rest } = data;
    delete rest.category;
    delete rest.totalStock;
    delete rest.sales;
    delete rest.createdAt;
    delete rest.updatedAt;
    const rate = this.normalizePointsAwardRate(rest.pointsAwardRate);
    if (rate !== undefined) rest.pointsAwardRate = rate;
    await this.prisma.product.update({
      where: { id },
      data: rest,
    });
    if (Array.isArray(skus)) {
      // 提交里没出现的旧 SKU 视为删除
      const existing = await this.prisma.sku.findMany({ where: { productId: id }, select: { id: true } });
      const incomingIds = new Set(skus.filter((s) => s.id).map((s) => s.id));
      const toRemove = existing.filter((e) => !incomingIds.has(e.id)).map((e) => e.id);
      if (toRemove.length) {
        // 删除前先确认没有已售卡密关联（防误删）
        const sold = await this.prisma.cardKey.count({
          where: { skuId: { in: toRemove }, status: { in: ['SOLD', 'LOCKED'] } },
        });
        if (sold > 0) {
          throw new BadRequestException('部分被删除的规格仍有售出/锁定卡密，请先处理');
        }
        await this.prisma.cardKey.deleteMany({ where: { skuId: { in: toRemove } } });
        await this.prisma.sku.deleteMany({ where: { id: { in: toRemove } } });
      }
      for (const s of skus) {
        const { id: skuId, productId: _p, sales: _s, createdAt: _c, updatedAt: _u, ...rest } = s;
        if (skuId) {
          await this.prisma.sku.update({ where: { id: skuId }, data: rest });
        } else {
          await this.prisma.sku.create({ data: { ...rest, productId: id } });
        }
      }
    }
    return this.detail(id);
  }

  async remove(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('商品不存在');

    // 历史订单通过外键引用了商品 / 规格，直接删除会触发约束错误（前台表现为"删除报错"）。
    // 订单是财务与售后凭证，不应随商品级联删除，因此提示管理员改用「下架」。
    const orderCount = await this.prisma.order.count({ where: { productId: id } });
    if (orderCount > 0) {
      throw new BadRequestException(
        `该商品存在 ${orderCount} 笔历史订单，无法删除。如需停售请改用「下架」，订单记录将完整保留。`,
      );
    }

    // 无订单引用时，连同规格与卡密一起清理（同一事务，保证原子性）
    return this.prisma.$transaction(async (tx) => {
      await tx.cardKey.deleteMany({ where: { productId: id } });
      await tx.sku.deleteMany({ where: { productId: id } });
      return tx.product.delete({ where: { id } });
    });
  }

  setStatus(id: number, status: 'ON_SALE' | 'OFF_SHELF' | 'DRAFT') {
    return this.prisma.product.update({ where: { id }, data: { status } });
  }
}
