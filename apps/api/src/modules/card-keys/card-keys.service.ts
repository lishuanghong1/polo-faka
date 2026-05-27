import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CardKeysService {
  constructor(private prisma: PrismaService) {}

  list(query: { productId?: number; skuId?: number; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where: any = {};
    if (query.productId) where.productId = Number(query.productId);
    if (query.skuId) where.skuId = Number(query.skuId);
    if (query.status) where.status = query.status;
    return this.prisma.$transaction([
      this.prisma.cardKey.count({ where }),
      this.prisma.cardKey.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]).then(([total, items]) => ({ total, page, pageSize, items }));
  }

  /** 批量录入：content 行分隔，自动去重；单次最多 5000 行防数据库压力 */
  async bulkImport(productId: number, skuId: number, raw: string, remark?: string) {
    if (typeof raw !== 'string') {
      throw new Error('content 必须是字符串');
    }
    if (raw.length > 5_000_000) {
      throw new Error('单次导入大小超过 5MB 上限');
    }
    const lines = Array.from(
      new Set(
        raw
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    if (!lines.length) return { inserted: 0, duplicated: 0, total: 0 };
    if (lines.length > 5000) {
      throw new Error(`单次最多导入 5000 行（当前 ${lines.length} 行），请分批`);
    }
    // 单条最长 4KB，防 BLOB 注入式撑爆
    for (const l of lines) {
      if (l.length > 4096) {
        throw new Error('存在单条超过 4KB 的内容，请检查输入');
      }
    }

    // 库内已存在的 content（同一 SKU 下）排除
    const existing = await this.prisma.cardKey.findMany({
      where: { skuId, content: { in: lines } },
      select: { content: true },
    });
    const existSet = new Set(existing.map((e) => e.content));
    const fresh = lines.filter((l) => !existSet.has(l));

    if (!fresh.length) {
      return { inserted: 0, duplicated: lines.length, total: lines.length };
    }

    const data = fresh.map((content) => ({ productId, skuId, content, remark }));
    const created = await this.prisma.cardKey.createMany({ data });
    return {
      inserted: created.count,
      duplicated: lines.length - created.count,
      total: lines.length,
    };
  }

  update(id: number, data: any) {
    return this.prisma.cardKey.update({ where: { id }, data });
  }

  remove(id: number) {
    return this.prisma.cardKey.delete({ where: { id } });
  }

  /** 批量删除 */
  async bulkRemove(ids: number[]) {
    if (!ids?.length) return { deleted: 0 };
    const r = await this.prisma.cardKey.deleteMany({ where: { id: { in: ids } } });
    return { deleted: r.count };
  }

  /** 按 SKU 状态分组聚合统计 */
  async stats() {
    const rows = await this.prisma.cardKey.groupBy({
      by: ['skuId', 'status'],
      _count: { _all: true },
    });
    return rows;
  }

  /** 库存概览：按商品+规格统计每个状态的数量（含商品 / 规格名） */
  async overview() {
    const groups = await this.prisma.cardKey.groupBy({
      by: ['productId', 'skuId', 'status'],
      _count: { _all: true },
    });
    if (!groups.length) return [];
    const skuIds = Array.from(new Set(groups.map((g) => g.skuId)));
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: skuIds } },
      include: { product: { select: { id: true, title: true, status: true } } },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));

    const result = new Map<
      number,
      {
        skuId: number;
        skuName: string;
        productId: number;
        productTitle: string;
        productStatus: string;
        price: any;
        AVAILABLE: number;
        SOLD: number;
        LOCKED: number;
        EXPIRED: number;
        REFUNDED: number;
        total: number;
      }
    >();

    for (const g of groups) {
      const sku = skuMap.get(g.skuId);
      if (!sku) continue;
      const entry =
        result.get(g.skuId) ||
        {
          skuId: g.skuId,
          skuName: sku.name,
          productId: sku.product.id,
          productTitle: sku.product.title,
          productStatus: sku.product.status,
          price: sku.price,
          AVAILABLE: 0,
          SOLD: 0,
          LOCKED: 0,
          EXPIRED: 0,
          REFUNDED: 0,
          total: 0,
        };
      (entry as any)[g.status] = g._count._all;
      entry.total += g._count._all;
      result.set(g.skuId, entry);
    }
    return Array.from(result.values()).sort((a, b) => b.AVAILABLE - a.AVAILABLE);
  }

  /** 一键清理某 SKU 下指定状态的卡密（SOLD / EXPIRED 等） */
  async purge(skuId: number, status: string) {
    const r = await this.prisma.cardKey.deleteMany({
      where: { skuId, status: status as any },
    });
    return { deleted: r.count };
  }
}
