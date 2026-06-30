import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import Redis from 'ioredis';
import dayjs from 'dayjs';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { VipService } from '../vip/vip.service';
import { PoolService } from '../pool/pool.service';
import { PointsService } from '../points/points.service';
import { AizhpOpenService } from '../aizhp-open/aizhp-open.service';
import { CreateOrderDto, PayMethodDto } from './dto';

function isWarehouseDeliveryRemark(remark?: string | null) {
  return /^from warehouse #\d+$/i.test(String(remark || '').trim());
}

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private vip: VipService,
    private pool: PoolService,
    private points: PointsService,
    private aizhpOpen: AizhpOpenService,
  ) {}

  /** 计算实际单价（考虑批量阶梯价） */
  private calcUnitPrice(skuPrice: number, qty: number, bulk: any[] | null) {
    if (!Array.isArray(bulk) || bulk.length === 0) return skuPrice;
    let match: { min: number; max: number; price: number } | null = null;
    for (const b of bulk) {
      if (qty >= b.min && qty <= b.max) {
        match = b;
        break;
      }
    }
    return match ? Number(match.price) : skuPrice;
  }

  async create(dto: CreateOrderDto, userId?: number, ip?: string) {
    const sku = await this.prisma.sku.findUnique({
      where: { id: dto.skuId },
      include: { product: true },
    });
    if (!sku || sku.productId !== dto.productId) {
      throw new NotFoundException('商品规格不存在');
    }
    if (!sku.visible || sku.product.status !== 'ON_SALE') {
      throw new BadRequestException('商品已下架');
    }
    if (sku.product.deliveryType === 'POOL_QUOTA' && !userId) {
      throw new BadRequestException('号池额度包需要登录后购买');
    }

    const unitPrice = this.calcUnitPrice(
      Number(sku.price),
      dto.quantity,
      sku.product.bulkPricing as any,
    );
    const total = +(unitPrice * dto.quantity).toFixed(2);

    // VIP 折扣计算（兑换码/未登录场景 discount=1）
    const vipResult = await this.vip.applyDiscount(
      userId,
      'LOCAL',
      String(dto.productId),
      total,
    );
    const discountAmount = vipResult.discountAmount;
    const payAmount = vipResult.payAmount;

    const orderNo = this.makeOrderNo();
    const expireAt = dayjs().add(15, 'minute').toDate();

    if (dto.payMethod === PayMethodDto.BALANCE) {
      if (!userId) throw new BadRequestException('余额支付需要登录');
      const u = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!u) throw new BadRequestException('未登录');
      if (u.status !== 'ACTIVE') throw new BadRequestException('账号已被禁用');
      if (Number(u.balance) < payAmount) throw new BadRequestException('余额不足');
    }
    const pointsUsed = dto.payMethod === PayMethodDto.POINTS
      ? this.points.pointsRequiredForAmount(payAmount)
      : 0;
    if (dto.payMethod === PayMethodDto.POINTS) {
      if (!userId) throw new BadRequestException('积分支付需要登录');
      if (!sku.product.pointsPayEnabled) {
        throw new BadRequestException('该商品暂不支持积分支付');
      }
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true, points: true },
      });
      if (!u) throw new BadRequestException('未登录');
      if (u.status !== 'ACTIVE') throw new BadRequestException('账号已被禁用');
      if (u.points < pointsUsed) throw new BadRequestException('积分不足');
    }

    const order = await this.prisma.order.create({
      data: {
        orderNo,
        userId: userId ?? null,
        productId: dto.productId,
        skuId: dto.skuId,
        productTitle: sku.product.title,
        skuName: sku.name,
        unitPrice,
        quantity: dto.quantity,
        totalAmount: total,
        discountAmount,
        payAmount,
        pointsUsed,
        payMethod: dto.payMethod as any,
        vipTier: vipResult.tier,
        status: 'PENDING',
        contact: dto.contact,
        remark: dto.remark,
        ip,
        expireAt,
      },
    });

    // 余额支付：立即结算
    if (dto.payMethod === PayMethodDto.BALANCE && userId) {
      await this.payWithBalance(order.orderNo, userId);
    }
    if (dto.payMethod === PayMethodDto.POINTS && userId) {
      await this.payWithPoints(order.orderNo, userId);
    }

    return this.detail(order.orderNo);
  }

  /** Mock 支付：仅供本地开发用，把订单置为已支付并触发出库 */
  async mockPay(orderNo: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING') throw new BadRequestException('订单状态不允许支付');
    await this.markPaidAndDeliver(orderNo);
    return this.detail(orderNo);
  }

  /**
   * 余额支付（即时结算）。
   * 防 TOCTOU：扣余额使用 `updateMany where balance >= total` 原子条件更新，
   * 再读最新余额写入流水；任何并发争用都会安全退出而不会扣成负数。
   */
  async payWithBalance(orderNo: string, userId: number) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { orderNo } });
      if (!order || order.userId !== userId) throw new NotFoundException('订单不存在');
      if (order.status !== 'PENDING') throw new BadRequestException('订单状态不允许支付');

      const amount = new Prisma.Decimal(Number(order.payAmount));

      // 原子扣余额：仅在 balance >= amount 时执行，避免并发把余额扣成负数
      const r = await tx.user.updateMany({
        where: { id: userId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (r.count === 0) {
        throw new BadRequestException('余额不足');
      }

      const after = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });
      const newBalance = Number(after?.balance ?? 0);

      await tx.balanceLog.create({
        data: {
          userId,
          amount: amount.negated(),
          balance: new Prisma.Decimal(newBalance),
          type: 'CONSUME',
          note: `订单 ${orderNo}`,
          refOrder: orderNo,
        },
      });
      await tx.order.update({
        where: { orderNo },
        data: { status: 'PAID', paidAt: new Date() },
      });
    });
    await this.markPaidAndDeliver(orderNo);
  }

  async payWithPoints(orderNo: string, userId: number) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { orderNo } });
      if (!order || order.userId !== userId) throw new NotFoundException('订单不存在');
      if (order.status !== 'PENDING') throw new BadRequestException('订单状态不允许支付');
      if (order.payMethod !== 'POINTS') throw new BadRequestException('订单不是积分支付');

      const pointsUsed = order.pointsUsed || this.points.pointsRequiredForAmount(Number(order.payAmount));
      await this.points.deductForOrder(tx, userId, orderNo, pointsUsed);
      await tx.order.update({
        where: { orderNo },
        data: { status: 'PAID', paidAt: new Date(), pointsUsed },
      });
    });
    await this.markPaidAndDeliver(orderNo);
  }

  /**
   * 仅推进订单到 PAID（不发货），<100ms，由 alipay notify 调用。
   * 返回 'recorded' = 这次推进了；'already' = 已经是终态。
   * 任何不一致抛错让 notify 回 fail。
   */
  async markPaidOnly(
    orderNo: string,
    tradeNo: string,
    paidAmount: number,
    buyerLogonId?: string,
  ): Promise<'recorded' | 'already'> {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (Math.abs(Number(order.payAmount) - paidAmount) > 0.01) {
      throw new BadRequestException(
        `金额不一致：订单 ¥${order.payAmount}，支付 ¥${paidAmount}`,
      );
    }
    if (['PAID', 'DELIVERED', 'REFUNDED', 'CANCELLED'].includes(order.status)) {
      return 'already';
    }
    if (order.status !== 'PENDING') {
      throw new BadRequestException(`订单状态 ${order.status} 不允许标记已付款`);
    }
    await this.prisma.order.update({
      where: { orderNo },
      data: {
        status: 'PAID',
        thirdTradeNo: tradeNo,
        buyerLogonId: buyerLogonId?.slice(0, 128),
        paidAt: new Date(),
      },
    });
    return 'recorded';
  }

  /** 异步发货（notify / cron 用），失败标 PAID 不抛错 */
  deliverAsync(orderNo: string): void {
    setImmediate(() => {
      this.markPaidAndDeliver(orderNo).catch((e) => {
        // markPaidAndDeliver 本身大部分错误已吞掉；这里兜底
        // eslint-disable-next-line no-console
        console.error(`[orders.deliverAsync] ${orderNo}:`, (e as Error).message);
      });
    });
  }

  /** 标记已支付并自动分配卡密 */
  async markPaidAndDeliver(orderNo: string) {
    const lockKey = `lock:order:${orderNo}`;
    // Redis 异常时返回字符串 'OK' 走降级（不加锁仍可正常执行），
    // 正常情况下 set NX：第一次拿到锁返回 'OK'；已有锁返回 null。
    const got = await this.redis
      .set(lockKey, '1', 'EX', 30, 'NX')
      .catch(() => 'OK');
    // 没拿到锁 → 其它实例正在处理，直接放弃，避免重复分配卡密
    if (got !== 'OK') {
      return;
    }

    try {
      const order = await this.prisma.order.findUnique({
        where: { orderNo },
        include: { product: true },
      });
      if (!order) return;
      if (order.status === 'DELIVERED' || order.status === 'REFUNDED') return;

      // 如果还是 PENDING，先置 PAID
      if (order.status === 'PENDING') {
        await this.prisma.order.update({
          where: { orderNo },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }

      if (order.product.deliveryType === 'POOL_QUOTA') {
        await this.pool.createGrantForOrder(orderNo);
        await this.prisma.$transaction([
          this.prisma.order.update({
            where: { orderNo },
            data: { status: 'DELIVERED', deliveredAt: new Date() },
          }),
          this.prisma.sku.update({
            where: { id: order.skuId },
            data: { sales: { increment: order.quantity } },
          }),
          this.prisma.product.update({
            where: { id: order.productId },
            data: { sales: { increment: order.quantity } },
          }),
        ]);
        return;
      }

      // ── AIZHP 渠道发货 ──
      if (order.product.deliveryType === 'AIZHP') {
        const account = await this.aizhpOpen.fetchUnusedAccount();
        if (!account) {
          // 无可用账号，订单停留 PAID 状态等待人工处理
          return;
        }
        // 从 SKU attrs 读取档位
        const sku = await this.prisma.sku.findUnique({ where: { id: order.skuId }, select: { attrs: true } });
        const aizhpPlan = (sku?.attrs as any)?.aizhpPlan || 'pro';
        // 将获取的账号写入卡密表（复用现有卡密展示逻辑）
        await this.prisma.$transaction(async (tx) => {
          await tx.cardKey.create({
            data: {
              productId: order.productId,
              skuId: order.skuId,
              content: account.email,
              status: 'SOLD',
              soldAt: new Date(),
              orderNo,
              remark: `[aizhp:${aizhpPlan}] id=${account.id} group=${account.group_name}`,
            },
          });
          await tx.order.update({
            where: { orderNo },
            data: { status: 'DELIVERED', deliveredAt: new Date() },
          });
          await tx.sku.update({
            where: { id: order.skuId },
            data: { sales: { increment: order.quantity } },
          });
          await tx.product.update({
            where: { id: order.productId },
            data: { sales: { increment: order.quantity } },
          });
          await this.points.settleDeliveredLocalOrder(tx, orderNo);
        });
        return;
      }

      // 取出 quantity 张可用卡密（用事务 + CAS 守卫，防并发抢占）
      const need = order.quantity;
      const picked = await this.prisma.$transaction(async (tx) => {
        const list = await tx.cardKey.findMany({
          where: { skuId: order.skuId, status: 'AVAILABLE' },
          take: need,
          orderBy: { id: 'asc' },
        });
        if (list.length < need) return [];
        const ids = list.map((c) => c.id);
        // 仅当卡密仍是 AVAILABLE 时才标 SOLD；count 不足说明被并发抢占了
        const soldAt = new Date();
        const r = await tx.cardKey.updateMany({
          where: { id: { in: ids }, status: 'AVAILABLE' },
          data: {
            status: 'SOLD',
            soldAt,
            orderNo,
          },
        });
        if (r.count < need) {
          // 让事务回滚，外层会进入「库存不足」分支，订单卡在 PAID 待人工
          throw new Error('卡密被并发抢占，事务回滚');
        }
        // 同步：若卡密来自外部仓库（warehouse_accounts），更新其 SOLD 状态
        await tx.warehouseAccount.updateMany({
          where: { cardKeyId: { in: ids } },
          data: { status: 'SOLD', soldAt, orderNo },
        });
        return list;
      }).catch((e) => {
        if ((e as Error).message?.includes('并发抢占')) return [];
        throw e;
      });

      if (picked.length === 0) {
        // 库存不足 -> 标记为已支付但未发货（人工处理）
        return;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { orderNo },
          data: { status: 'DELIVERED', deliveredAt: new Date() },
        });
        await tx.sku.update({
          where: { id: order.skuId },
          data: { sales: { increment: order.quantity } },
        });
        await tx.product.update({
          where: { id: order.productId },
          data: { sales: { increment: order.quantity } },
        });
        await this.points.settleDeliveredLocalOrder(tx, orderNo);
      });
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch {}
    }
  }

  async detail(orderNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: {
        product: { select: { deliveryType: true } },
        cardKeys: {
          select: {
            id: true,
            content: true,
            remark: true,
            soldAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');

    // 兑换码支付：附带兑换码（仅用于详情页展示，便于客户在「再次输入兑换码」时识别）
    let redeemCode: string | null = null;
    if (order.payMethod === 'REDEEM') {
      const rec = await this.prisma.redeemRecord.findFirst({
        where: { orderNo },
        orderBy: { id: 'desc' },
        include: { code: { select: { code: true } } },
      });
      redeemCode = rec?.code?.code ?? null;
    }

    const cardKeyIds = order.cardKeys.map((cardKey) => cardKey.id);
    const warehouseRefs = cardKeyIds.length
      ? await this.prisma.warehouseAccount.findMany({
          where: { cardKeyId: { in: cardKeyIds } },
          select: { cardKeyId: true },
        })
      : [];
    const warehouseCardKeyIds = new Set(warehouseRefs.map((ref) => ref.cardKeyId).filter(Boolean));

    const cardKeys = order.cardKeys.map(({ remark, ...cardKey }) => ({
      ...cardKey,
      isWarehouseDelivery:
        warehouseCardKeyIds.has(cardKey.id) || isWarehouseDeliveryRemark(remark),
    }));

    // AIZHP 订单：查询退款状态
    let aizhpRefund: { id: number; status: string; plan?: string } | null = null;
    if ((order.product.deliveryType as string) === 'AIZHP' && order.status === 'DELIVERED' && order.cardKeys.length) {
      const ck = order.cardKeys[0];
      const refundMatch = (ck.remark || '').match(/refund=(\d+)/);
      const planMatch = (ck.remark || '').match(/\[aizhp:([^\]]+)\]/);
      if (refundMatch) {
        const refundId = Number(refundMatch[1]);
        const refundInfo = await this.aizhpOpen.getRefundStatus(refundId);
        aizhpRefund = refundInfo
          ? { id: refundInfo.id, status: refundInfo.status, plan: planMatch?.[1] || undefined }
          : { id: refundId, status: 'unknown', plan: planMatch?.[1] || undefined };
      }
    }

    return { ...order, cardKeys, redeemCode, aizhpRefund };
  }

  /**
   * 管理员订单详情：在 detail() 基础上附带下单用户概要（用户名/昵称/邮箱/VIP）。
   * 注意：用户信息只在此 admin 专用方法返回，公开的 detail()/query() 不暴露，避免 PII 泄露。
   */
  async adminDetail(orderNo: string) {
    const detail = await this.detail(orderNo);
    const user = detail.userId
      ? await this.prisma.user.findUnique({
          where: { id: detail.userId },
          select: { id: true, username: true, nickname: true, email: true, vipTier: true },
        })
      : null;
    return { ...detail, user };
  }

  async listMine(userId: number, page = 1, pageSize = 20) {
    if (!userId || typeof userId !== 'number') {
      throw new BadRequestException('未登录');
    }
    const where = { userId };
    const [total, rawItems] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          cardKeys: { select: { content: true } },
          product: { select: { deliveryType: true } },
        },
      }),
    ]);
    const items = rawItems.map(({ product, ...order }) => ({
      ...order,
      deliveryType: product?.deliveryType ?? null,
    }));
    return { total, page, pageSize, items };
  }

  /**
   * 公开订单查询（订单号 + 可选 contact 校验）。
   * - 订单本身没有 contact：订单号 16 位随机串足够防爆破，直接返回完整数据（含卡密）
   * - 订单本身有 contact：必须传匹配的 contact 才能拿到完整数据
   *   · 未传 contact → 200 返回 `{ requireContact: true, orderNo, status }`，让前端弹联系方式输入
   *   · 传错 contact → 抛 404（防爆破）
   * 登录用户也可直接走 /orders/mine 拿完整数据。
   */
  async query(orderNo: string, contact?: string) {
    const order = await this.detail(orderNo);
    if (order.contact) {
      const provided = contact?.trim();
      if (!provided) {
        return {
          requireContact: true,
          orderNo: order.orderNo,
          status: order.status,
        };
      }
      if (provided !== order.contact) {
        throw new NotFoundException('订单不存在');
      }
    }
    return order;
  }

  /** 管理员：删除订单（仅未支付/已退款/已取消/已过期的订单，已支付订单先退款再删） */
  async adminDelete(orderNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: { cardKeys: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (['PAID', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException(
        '已支付/已发货的订单不可直接删除，请先退款再删除',
      );
    }
    // 回收卡密：未发货的订单上若有锁定的卡密，回到 AVAILABLE
    await this.prisma.$transaction(async (tx) => {
      for (const c of order.cardKeys) {
        await tx.cardKey.update({
          where: { id: c.id },
          data: { status: 'AVAILABLE', soldAt: null, orderNo: null },
        });
      }
      await tx.order.delete({ where: { orderNo } });
    });
    return { ok: true };
  }

  /** 管理员：标记订单为已支付，并尝试发货 */
  async adminMarkPaid(orderNo: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING') {
      throw new BadRequestException('订单状态不允许标记为已支付');
    }
    await this.markPaidAndDeliver(orderNo);
    return this.detail(orderNo);
  }

  /** 管理员：手动补发卡密（用于库存不足导致 PAID 卡住的订单） */
  async adminRedeliver(orderNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: { cardKeys: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === 'DELIVERED' && order.cardKeys.length >= order.quantity) {
      throw new BadRequestException('订单已发货');
    }
    if (!['PAID', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException('订单状态不支持发货');
    }
    await this.markPaidAndDeliver(orderNo);
    return this.detail(orderNo);
  }

  /** 管理员：手动指定卡密内容发货 */
  async adminManualDeliver(orderNo: string, contents: string[]) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: { cardKeys: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const need = order.quantity - order.cardKeys.length;
    if (need <= 0) throw new BadRequestException('订单已配齐卡密');
    if (contents.length < need) {
      throw new BadRequestException(`还需要 ${need} 条卡密，仅提供了 ${contents.length} 条`);
    }
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < need; i++) {
        await tx.cardKey.create({
          data: {
            productId: order.productId,
            skuId: order.skuId,
            content: contents[i],
            status: 'SOLD',
            soldAt: new Date(),
            orderNo,
            remark: '管理员手动发货',
          },
        });
      }
      await tx.order.update({
        where: { orderNo },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
        },
      });
    });
    return this.detail(orderNo);
  }

  /** 管理员：退款（恢复卡密为 AVAILABLE / 余额回退） */
  async adminRefund(orderNo: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: { cardKeys: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (!['PAID', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException('只有已支付/已发货订单可退款');
    }

    await this.prisma.$transaction(async (tx) => {
      // 卡密回退：手动发货的（remark="管理员手动发货"）直接标 REFUNDED，否则回到 AVAILABLE 池
      for (const c of order.cardKeys) {
        if (c.remark === '管理员手动发货') {
          await tx.cardKey.update({
            where: { id: c.id },
            data: { status: 'REFUNDED', orderNo: null },
          });
        } else {
          await tx.cardKey.update({
            where: { id: c.id },
            data: { status: 'AVAILABLE', soldAt: null, orderNo: null },
          });
        }
      }
      await tx.order.update({
        where: { orderNo },
        data: {
          status: 'REFUNDED',
          remark: reason ? `[退款] ${reason}` : '[退款]',
        },
      });
      // 销量回滚
      await tx.sku.update({
        where: { id: order.skuId },
        data: { sales: { decrement: order.quantity } },
      });
      await tx.product.update({
        where: { id: order.productId },
        data: { sales: { decrement: order.quantity } },
      });
      // 余额支付：退还余额（原子 increment + 流水幂等去重，防并发 lost-update）
      if (order.payMethod === 'BALANCE' && order.userId) {
        const dup = await tx.balanceLog.findFirst({
          where: { refOrder: orderNo, type: 'REFUND' },
          select: { id: true },
        });
        if (!dup) {
          const amountDec = new Prisma.Decimal(Number(order.payAmount));
          const u = await tx.user.update({
            where: { id: order.userId },
            data: { balance: { increment: amountDec } },
          });
          await tx.balanceLog.create({
            data: {
              userId: order.userId,
              amount: amountDec,
              balance: new Prisma.Decimal(Number(u.balance)),
              type: 'REFUND',
              note: `退款 ${orderNo}`,
              refOrder: orderNo,
            },
          });
        }
      }
      // 积分支付：退还本单扣掉的积分；消费/邀请奖励暂不自动追回。
      if (order.payMethod === 'POINTS' && order.userId && order.pointsUsed > 0) {
        await this.points.refundDeductedPoints(tx, order.userId, orderNo, order.pointsUsed);
      }
    });
    return this.detail(orderNo);
  }

  /** 管理员：取消未支付订单 */
  async adminCancel(orderNo: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING') {
      throw new BadRequestException('只有待支付订单可取消');
    }
    await this.prisma.order.update({
      where: { orderNo },
      data: { status: 'CANCELLED' },
    });
    return this.detail(orderNo);
  }

  private makeOrderNo() {
    // 时间戳便于人眼定位，但安全凭证靠后面 16 位 URL-safe 随机串
    return `P${dayjs().format('YYYYMMDDHHmmss')}${nanoid(16)}`;
  }
}
