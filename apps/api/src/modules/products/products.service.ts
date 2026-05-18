import { Injectable, NotFoundException } from '@nestjs/common';
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

    const list = await Promise.all(
      items.map(async (p) => {
        const stockBySku = await this.computeStockBySku(p.id);
        const skus = p.skus.map((s) => ({ ...s, stock: stockBySku[s.id] ?? s.stock }));
        const totalStock = skus.reduce((a, b) => a + (b.stock || 0), 0);
        return { ...p, skus, totalStock };
      }),
    );

    return { total, page, pageSize, items: list };
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
    const stockBySku = await this.computeStockBySku(p.id);
    return {
      ...p,
      skus: p.skus.map((s) => ({ ...s, stock: stockBySku[s.id] ?? s.stock })),
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

  // ====== Admin ======
  create(data: any) {
    const { skus = [], ...rest } = data;
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
          throw new Error('部分被删除的规格仍有售出/锁定卡密，请先处理');
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
    await this.prisma.cardKey.deleteMany({ where: { productId: id } });
    await this.prisma.sku.deleteMany({ where: { productId: id } });
    return this.prisma.product.delete({ where: { id } });
  }

  setStatus(id: number, status: 'ON_SALE' | 'OFF_SHELF' | 'DRAFT') {
    return this.prisma.product.update({ where: { id }, data: { status } });
  }
}
