import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async dashboard() {
    const now = new Date();
    const startOfDay = dayjs().startOf('day').toDate();
    const startOf7d = dayjs().subtract(7, 'day').startOf('day').toDate();

    const [
      productCount,
      onSale,
      userCount,
      todayOrders,
      todayPaid,
      todayRevenue,
      weekRevenue,
      pendingCount,
      cardKeyTotal,
      cardKeyAvail,
      poolAccounts,
    ] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({ where: { status: 'ON_SALE' } }),
      this.prisma.user.count(),
      this.prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.order.count({
        where: { createdAt: { gte: startOfDay }, status: { in: ['PAID', 'DELIVERED'] } },
      }),
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: { paidAt: { gte: startOfDay, not: null } },
      }),
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: { paidAt: { gte: startOf7d, not: null } },
      }),
      this.prisma.order.count({ where: { status: 'PAID' } }),
      this.prisma.cardKey.count(),
      this.prisma.cardKey.count({ where: { status: 'AVAILABLE' } }),
      this.prisma.poolAccount.count(),
    ]);

    return {
      now,
      product: { total: productCount, onSale },
      user: { total: userCount },
      order: {
        today: todayOrders,
        todayPaid,
        todayRevenue: todayRevenue._sum.totalAmount ?? 0,
        weekRevenue: weekRevenue._sum.totalAmount ?? 0,
        pendingDeliver: pendingCount,
      },
      cardKey: { total: cardKeyTotal, available: cardKeyAvail },
      pool: { accounts: poolAccounts },
    };
  }

  recentOrders(limit = 20) {
    return this.prisma.order.findMany({
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        id: true,
        orderNo: true,
        productTitle: true,
        skuName: true,
        quantity: true,
        totalAmount: true,
        status: true,
        payMethod: true,
        createdAt: true,
        paidAt: true,
      },
    });
  }

  listOrders(query: any) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { orderNo: { contains: query.keyword } },
        { productTitle: { contains: query.keyword } },
      ];
    }
    return this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]).then(([total, items]) => ({ total, page, pageSize, items }));
  }

  /** N 天内每日营收 / 订单数 */
  async revenueTrend(days = 14) {
    const since = dayjs().subtract(days - 1, 'day').startOf('day');
    const rows = await this.prisma.order.findMany({
      where: {
        paidAt: { not: null, gte: since.toDate() },
        status: { in: ['PAID', 'DELIVERED'] },
      },
      select: { paidAt: true, totalAmount: true },
    });

    const buckets: Record<string, { date: string; revenue: number; orders: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = since.add(i, 'day').format('YYYY-MM-DD');
      buckets[d] = { date: d, revenue: 0, orders: 0 };
    }
    for (const r of rows) {
      const d = dayjs(r.paidAt!).format('YYYY-MM-DD');
      if (!buckets[d]) continue;
      buckets[d].revenue += Number(r.totalAmount);
      buckets[d].orders += 1;
    }
    return Object.values(buckets);
  }

  /** 库存预警：可售卡密 < threshold 的 SKU */
  async stockAlerts(threshold = 5) {
    const skus = await this.prisma.sku.findMany({
      where: { visible: true, product: { status: 'ON_SALE' } },
      include: { product: { select: { id: true, title: true } } },
    });
    const ids = skus.map((s) => s.id);
    if (!ids.length) return [];

    const counts = await this.prisma.cardKey.groupBy({
      by: ['skuId'],
      where: { skuId: { in: ids }, status: 'AVAILABLE' },
      _count: { _all: true },
    });
    const map = new Map(counts.map((c) => [c.skuId, c._count._all]));

    return skus
      .map((s) => ({
        skuId: s.id,
        skuName: s.name,
        productId: s.product.id,
        productTitle: s.product.title,
        price: s.price,
        available: map.get(s.id) ?? 0,
      }))
      .filter((s) => s.available < threshold)
      .sort((a, b) => a.available - b.available)
      .slice(0, 20);
  }
}
