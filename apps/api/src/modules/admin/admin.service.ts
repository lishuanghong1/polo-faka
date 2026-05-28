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
      todayOrdersLocal,
      todayOrdersForge,
      todayPaidLocal,
      todayPaidForge,
      todayRevenueLocal,
      todayRevenueForge,
      weekRevenueLocal,
      weekRevenueForge,
      pendingLocal,
      pendingForge,
      cardKeyTotal,
      cardKeyAvail,
      poolAccounts,
    ] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({ where: { status: 'ON_SALE' } }),
      this.prisma.user.count(),
      // 今日订单数（含全部状态）
      this.prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.forgeOrder.count({ where: { createdAt: { gte: startOfDay } } }),
      // 今日成交订单数（已支付/已发货，排除退款）
      this.prisma.order.count({
        where: {
          createdAt: { gte: startOfDay },
          status: { in: ['PAID', 'DELIVERED'] },
        },
      }),
      this.prisma.forgeOrder.count({
        where: {
          createdAt: { gte: startOfDay },
          status: { in: ['PAID', 'DELIVERED'] },
        },
      }),
      // 今日营收（按支付时间，排除退款）
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: {
          paidAt: { gte: startOfDay, not: null },
          status: { in: ['PAID', 'DELIVERED'] },
        },
      }),
      this.prisma.forgeOrder.aggregate({
        _sum: { totalAmount: true },
        where: {
          paidAt: { gte: startOfDay, not: null },
          status: { in: ['PAID', 'DELIVERED'] },
        },
      }),
      // 7 日营收（同上）
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: {
          paidAt: { gte: startOf7d, not: null },
          status: { in: ['PAID', 'DELIVERED'] },
        },
      }),
      this.prisma.forgeOrder.aggregate({
        _sum: { totalAmount: true },
        where: {
          paidAt: { gte: startOf7d, not: null },
          status: { in: ['PAID', 'DELIVERED'] },
        },
      }),
      // 待处理：本地 PAID（卡密尚未发出）；Forge PAID + FAILED（需人工重发）
      this.prisma.order.count({ where: { status: 'PAID' } }),
      this.prisma.forgeOrder.count({
        where: { status: { in: ['PAID', 'FAILED'] } },
      }),
      this.prisma.cardKey.count(),
      this.prisma.cardKey.count({ where: { status: 'AVAILABLE' } }),
      this.prisma.poolAccount.count(),
    ]);

    const todayRevenue =
      Number(todayRevenueLocal._sum.totalAmount ?? 0) +
      Number(todayRevenueForge._sum.totalAmount ?? 0);
    const weekRevenue =
      Number(weekRevenueLocal._sum.totalAmount ?? 0) +
      Number(weekRevenueForge._sum.totalAmount ?? 0);

    return {
      now,
      product: { total: productCount, onSale },
      user: { total: userCount },
      order: {
        today: todayOrdersLocal + todayOrdersForge,
        todayPaid: todayPaidLocal + todayPaidForge,
        todayRevenue: +todayRevenue.toFixed(2),
        weekRevenue: +weekRevenue.toFixed(2),
        pendingDeliver: pendingLocal + pendingForge,
        // 拆分便于审计
        breakdown: {
          local: {
            today: todayOrdersLocal,
            todayPaid: todayPaidLocal,
            todayRevenue: Number(todayRevenueLocal._sum.totalAmount ?? 0),
            weekRevenue: Number(weekRevenueLocal._sum.totalAmount ?? 0),
            pendingDeliver: pendingLocal,
          },
          forge: {
            today: todayOrdersForge,
            todayPaid: todayPaidForge,
            todayRevenue: Number(todayRevenueForge._sum.totalAmount ?? 0),
            weekRevenue: Number(weekRevenueForge._sum.totalAmount ?? 0),
            pendingDeliver: pendingForge,
          },
        },
      },
      cardKey: { total: cardKeyTotal, available: cardKeyAvail },
      pool: { accounts: poolAccounts },
    };
  }

  recentOrders(limit = 20) {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
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
      const kw = String(query.keyword).trim();
      if (kw) {
        where.OR = [
          { orderNo: { contains: kw } },
          { productTitle: { contains: kw } },
          { contact: { contains: kw } },
        ];
      }
    }
    return this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]).then(([total, items]) => ({ total, page, pageSize, items }));
  }

  /** N 天内每日营收 / 订单数（本地 + 三方合并） */
  async revenueTrend(days = 14) {
    const since = dayjs().subtract(days - 1, 'day').startOf('day');
    const [localRows, forgeRows] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          paidAt: { not: null, gte: since.toDate() },
          status: { in: ['PAID', 'DELIVERED'] },
        },
        select: { paidAt: true, totalAmount: true },
      }),
      this.prisma.forgeOrder.findMany({
        where: {
          paidAt: { not: null, gte: since.toDate() },
          status: { in: ['PAID', 'DELIVERED'] },
        },
        select: { paidAt: true, totalAmount: true },
      }),
    ]);

    const buckets: Record<string, { date: string; revenue: number; orders: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = since.add(i, 'day').format('YYYY-MM-DD');
      buckets[d] = { date: d, revenue: 0, orders: 0 };
    }
    for (const r of [...localRows, ...forgeRows]) {
      const d = dayjs(r.paidAt!).format('YYYY-MM-DD');
      if (!buckets[d]) continue;
      buckets[d].revenue += Number(r.totalAmount);
      buckets[d].orders += 1;
    }
    return Object.values(buckets).map((b) => ({
      ...b,
      revenue: +b.revenue.toFixed(2),
    }));
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
