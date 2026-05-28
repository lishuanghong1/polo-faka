import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { createHash } from 'crypto';
import dayjs from 'dayjs';
import {
  Prisma,
  ForgeOrderStatus,
  ForgePaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ForgeApiError, ForgeOpenapiService } from '../forge-openapi/forge-openapi.service';
import { encryptString, decryptString, isEncrypted } from '../../common/crypto.util';
import { ForgeProductsService } from './forge-products.service';

const orderNano = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

function makeOrderNo(): string {
  return `F${dayjs().format('YYYYMMDDHHmmss')}${orderNano()}`;
}

function makeCustomerRef(orderNo: string): string {
  const salt = process.env.POOL_ENCRYPTION_KEY || process.env.JWT_SECRET || 'polo_faka';
  return createHash('sha256').update(`${orderNo}::${salt}`).digest('hex').slice(0, 32);
}

/**
 * 三方订单核心服务：两条下单路径
 *   - REDEEM：兑换码扣余额 → 立即调三方 → 返回订单（同步）
 *   - ALIPAY：先创建 PENDING 订单 → 返回 orderNo → 前端走支付宝
 *             支付宝 notify 命中后调 fulfillOrder() → 调三方 → DELIVERED
 */
@Injectable()
export class ForgeOrdersService {
  private readonly logger = new Logger(ForgeOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private forge: ForgeOpenapiService,
    private products: ForgeProductsService,
  ) {}

  /** 兑换码路径：扣余额 + 立即调三方发货 */
  async createByRedeemCode(input: {
    code: string;
    typeKey: string;
    quantity: number;
    contact?: string;
    ip?: string;
    userId?: number | null;
  }) {
    const rawCode = (input.code || '').trim();
    if (!rawCode) throw new BadRequestException('请填写兑换码');

    const product = await this.products.getEnabledOrThrow(input.typeKey);
    this.validateQty(input.quantity);
    const displayPrice = Number(product.displayPrice);
    const totalAmount = +(displayPrice * input.quantity).toFixed(2);

    // ─── 事务内：预扣兑换码 + 创建 PENDING 订单 ───
    const { orderNo, codeRow } = await this.prisma.$transaction(async (tx) => {
      const code = await tx.forgeRedeemCode.findUnique({ where: { code: rawCode } });
      if (!code) throw new NotFoundException('兑换码不存在');
      if (code.status === 'DISABLED') throw new BadRequestException('该兑换码已被禁用');
      if (code.status === 'EXHAUSTED') throw new BadRequestException('该兑换码余额已用完');
      if (code.expireAt && code.expireAt.getTime() < Date.now()) {
        await tx.forgeRedeemCode.update({
          where: { id: code.id },
          data: { status: 'EXPIRED' },
        });
        throw new BadRequestException('该兑换码已过期');
      }
      const remaining = Number(code.totalAmount) - Number(code.usedAmount);
      if (remaining < totalAmount - 0.001) {
        throw new BadRequestException(
          `兑换码余额不足。剩余 ¥${remaining.toFixed(2)}，本次需 ¥${totalAmount.toFixed(2)}`,
        );
      }

      const newUsed = +(Number(code.usedAmount) + totalAmount).toFixed(2);
      const nextStatus =
        newUsed >= Number(code.totalAmount) - 0.001 ? 'EXHAUSTED' : 'ACTIVE';
      const updated = await tx.forgeRedeemCode.updateMany({
        where: { id: code.id, usedAmount: code.usedAmount, status: 'ACTIVE' },
        data: {
          usedAmount: new Prisma.Decimal(newUsed),
          status: nextStatus,
        },
      });
      if (updated.count === 0) throw new ConflictException('兑换繁忙，请重试');

      const orderNo = makeOrderNo();
      await tx.forgeOrder.create({
        data: {
          orderNo,
          userId: input.userId ?? null,
          redeemCodeId: code.id,
          paymentMethod: ForgePaymentMethod.REDEEM,
          typeKey: product.typeKey,
          typeName: product.typeName,
          quantity: input.quantity,
          displayPrice: new Prisma.Decimal(displayPrice),
          totalAmount: new Prisma.Decimal(totalAmount),
          contact: input.contact?.slice(0, 128),
          customerRef: makeCustomerRef(orderNo),
          status: ForgeOrderStatus.PAID, // 兑换码即时到账，跳过 PENDING
          paidAt: new Date(),
          ip: input.ip,
        },
      });
      return { orderNo, codeRow: code };
    });

    // ─── 事务外：调三方发货 ───
    try {
      await this.fulfillOrder(orderNo);
    } catch (e) {
      // 上游失败 → 回滚兑换码余额
      await this.prisma.forgeRedeemCode.update({
        where: { id: codeRow.id },
        data: {
          usedAmount: { decrement: new Prisma.Decimal(totalAmount) },
          status: 'ACTIVE',
        },
      }).catch(() => null);
      throw e; // 让 controller 转 HttpException
    }
    return this.detail(orderNo);
  }

  /** 支付宝路径：创建 PENDING 订单，等待 notify 触发 fulfillOrder */
  async createForAlipay(input: {
    typeKey: string;
    quantity: number;
    contact?: string;
    ip?: string;
    userId?: number | null;
  }) {
    const product = await this.products.getEnabledOrThrow(input.typeKey);
    this.validateQty(input.quantity);
    const displayPrice = Number(product.displayPrice);
    const totalAmount = +(displayPrice * input.quantity).toFixed(2);

    const orderNo = makeOrderNo();
    await this.prisma.forgeOrder.create({
      data: {
        orderNo,
        userId: input.userId ?? null,
        paymentMethod: ForgePaymentMethod.ALIPAY,
        typeKey: product.typeKey,
        typeName: product.typeName,
        quantity: input.quantity,
        displayPrice: new Prisma.Decimal(displayPrice),
        totalAmount: new Prisma.Decimal(totalAmount),
        contact: input.contact?.slice(0, 128),
        customerRef: makeCustomerRef(orderNo),
        status: ForgeOrderStatus.PENDING,
        expireAt: dayjs().add(15, 'minute').toDate(),
        ip: input.ip,
      },
    });
    return this.detail(orderNo);
  }

  /**
   * 仅做支付状态推进（PENDING → PAID），同步快速完成，<100ms。
   * 由 alipay notify 调用：金额校验 + 幂等 + 立即返回，发货走 fulfillAsync。
   *
   * 返回值：
   *   - 'recorded' = 这次确实把 PENDING 推进到了 PAID（外层应触发发货）
   *   - 'already'  = 已经是 PAID/DELIVERED 等终态（幂等命中，无需发货）
   * 任何不一致都抛错（金额、订单类型、状态非法等）→ 让 notify 回 fail 让支付宝重推。
   */
  async markPaid(
    orderNo: string,
    tradeNo: string,
    paidAmount: number,
    buyerLogonId?: string,
  ): Promise<'recorded' | 'already'> {
    const order = await this.prisma.forgeOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.paymentMethod !== ForgePaymentMethod.ALIPAY) {
      throw new BadRequestException('订单不是支付宝订单');
    }
    if (Math.abs(Number(order.totalAmount) - paidAmount) > 0.01) {
      throw new BadRequestException(
        `金额不一致：订单 ¥${order.totalAmount}，支付 ¥${paidAmount}`,
      );
    }
    // 幂等：终态直接返回
    if (
      order.status === ForgeOrderStatus.DELIVERED ||
      order.status === ForgeOrderStatus.PAID ||
      order.status === ForgeOrderStatus.REFUNDED
    ) {
      return 'already';
    }
    if (order.status !== ForgeOrderStatus.PENDING) {
      throw new BadRequestException(`订单状态 ${order.status} 不允许标记已付款`);
    }

    await this.prisma.forgeOrder.update({
      where: { orderNo },
      data: {
        status: ForgeOrderStatus.PAID,
        thirdTradeNo: tradeNo,
        buyerLogonId: buyerLogonId?.slice(0, 128),
        paidAt: new Date(),
      },
    });
    return 'recorded';
  }

  /**
   * 异步触发上游发货 + 自补发。
   * - 入参订单必须是 PAID 状态
   * - 失败会标 FAILED + failReason；不抛出（异步场景没人接）
   * - 幂等：已 DELIVERED 直接返回
   */
  fulfillAsync(orderNo: string): void {
    setImmediate(() => {
      this.fulfillOrder(orderNo).catch((e) => {
        this.logger.error(`fulfillAsync ${orderNo} failed: ${(e as Error).message}`);
      });
    });
  }

  /** 兼容旧名：notify 走 markPaid + fulfillAsync 替代 */
  async markPaidAndFulfill(orderNo: string, tradeNo: string, paidAmount: number) {
    const r = await this.markPaid(orderNo, tradeNo, paidAmount);
    if (r === 'recorded') {
      this.fulfillAsync(orderNo);
    }
  }

  /**
   * 调三方下单（HMAC 签名），把 accounts 加密入库，标 DELIVERED。
   * 任何失败标 FAILED（不在此处回滚余额，回滚交给上游调用方）。
   * 幂等：已 DELIVERED 直接返回。
   */
  async fulfillOrder(orderNo: string) {
    const order = await this.prisma.forgeOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === ForgeOrderStatus.DELIVERED) return;
    if (
      order.status !== ForgeOrderStatus.PAID &&
      order.status !== ForgeOrderStatus.FAILED
    ) {
      throw new BadRequestException(`订单状态 ${order.status} 不允许发货`);
    }

    try {
      const r = await this.forge.request<any>('POST', '/openapi/v1/orders', {
        type_key: order.typeKey,
        quantity: order.quantity,
        external_order_id: order.orderNo,
        customer_ref: order.customerRef,
      });
      const upstream = r.data || {};
      const encrypted = encryptString(JSON.stringify(upstream.accounts || []));
      await this.prisma.forgeOrder.update({
        where: { orderNo },
        data: {
          status: ForgeOrderStatus.DELIVERED,
          upstreamOrderNo: upstream.order_no,
          upstreamRequestId: r.requestId,
          upstreamAmount:
            upstream.amount !== undefined ? new Prisma.Decimal(upstream.amount) : null,
          upstreamData: encrypted,
          deliveredAt: new Date(),
          failReason: null,
        },
      });
    } catch (e) {
      const failCode = e instanceof ForgeApiError ? e.code : 'NETWORK_ERROR';
      const failMsg =
        e instanceof ForgeApiError
          ? ForgeOpenapiService.friendlyMessage(e.code, e.upstreamMessage)
          : (e as Error)?.message || '上游服务暂时不可用';

      await this.prisma.forgeOrder.update({
        where: { orderNo },
        data: {
          status: ForgeOrderStatus.FAILED,
          failReason: `${failCode}: ${failMsg}`.slice(0, 500),
        },
      });
      throw ForgeOpenapiService.toHttpException(e);
    }
  }

  /** 订单详情 + accounts 解密（用户/管理员都用） */
  async detail(orderNo: string) {
    const order = await this.prisma.forgeOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');

    let accounts: any[] = [];
    if (order.upstreamData) {
      try {
        const raw = isEncrypted(order.upstreamData)
          ? decryptString(order.upstreamData)
          : order.upstreamData;
        accounts = JSON.parse(raw) || [];
      } catch (e) {
        this.logger.error(`decrypt ${orderNo} accounts failed: ${(e as Error).message}`);
      }
    }

    return {
      orderNo: order.orderNo,
      paymentMethod: order.paymentMethod,
      typeKey: order.typeKey,
      typeName: order.typeName,
      quantity: order.quantity,
      displayPrice: Number(order.displayPrice),
      totalAmount: Number(order.totalAmount),
      contact: order.contact,
      status: order.status,
      thirdTradeNo: order.thirdTradeNo,
      paidAt: order.paidAt,
      expireAt: order.expireAt,
      upstreamOrderNo: order.upstreamOrderNo,
      upstreamAmount:
        order.upstreamAmount !== null ? Number(order.upstreamAmount) : null,
      deliveredAt: order.deliveredAt,
      failReason: order.failReason,
      createdAt: order.createdAt,
      accounts,
    };
  }

  /**
   * 公开查单：
   * - 订单本身没 contact：订单号本身带 12 位强随机，可防爆破，直接返回完整数据
   * - 订单本身有 contact：
   *   · 未传 contact → 200 返回 `{ requireContact: true, orderNo, status, paymentMethod }`
   *   · 传错 contact → 404（防爆破）
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
          paymentMethod: order.paymentMethod,
        };
      }
      if (provided !== order.contact) {
        throw new NotFoundException('订单不存在');
      }
    }
    return order;
  }

  /** 用户中心：登录用户的三方订单（按 userId） */
  async listMine(userId: number, page = 1, pageSize = 20) {
    if (!userId || typeof userId !== 'number') {
      throw new BadRequestException('未登录');
    }
    const where: Prisma.ForgeOrderWhereInput = { userId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.forgeOrder.count({ where }),
      this.prisma.forgeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((it) => ({
        orderNo: it.orderNo,
        typeKey: it.typeKey,
        typeName: it.typeName,
        quantity: it.quantity,
        displayPrice: Number(it.displayPrice),
        totalAmount: Number(it.totalAmount),
        contact: it.contact,
        paymentMethod: it.paymentMethod,
        status: it.status,
        paidAt: it.paidAt,
        deliveredAt: it.deliveredAt,
        createdAt: it.createdAt,
      })),
    };
  }

  /** 管理员：删除三方订单（已发货/已支付订单需先退款） */
  async adminDelete(orderNo: string) {
    const order = await this.prisma.forgeOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      order.status === ForgeOrderStatus.PAID ||
      order.status === ForgeOrderStatus.DELIVERED
    ) {
      throw new BadRequestException(
        '已支付/已发货的订单不可直接删除，请先退款再删除',
      );
    }
    await this.prisma.forgeOrder.delete({ where: { orderNo } });
    return { ok: true };
  }

  /** Admin 列表 */
  async listAdmin(query: {
    page?: number;
    pageSize?: number;
    status?: ForgeOrderStatus;
    paymentMethod?: ForgePaymentMethod;
    typeKey?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const where: Prisma.ForgeOrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.typeKey) where.typeKey = query.typeKey;
    if (query.keyword) {
      where.OR = [
        { orderNo: { contains: query.keyword } },
        { upstreamOrderNo: { contains: query.keyword } },
        { contact: { contains: query.keyword } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.forgeOrder.count({ where }),
      this.prisma.forgeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { redeemCode: { select: { code: true } } },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((it) => ({
        orderNo: it.orderNo,
        userId: it.userId,
        redeemCode: it.redeemCode?.code,
        paymentMethod: it.paymentMethod,
        typeKey: it.typeKey,
        typeName: it.typeName,
        quantity: it.quantity,
        displayPrice: Number(it.displayPrice),
        totalAmount: Number(it.totalAmount),
        contact: it.contact,
        status: it.status,
        thirdTradeNo: it.thirdTradeNo,
        upstreamOrderNo: it.upstreamOrderNo,
        upstreamAmount: it.upstreamAmount !== null ? Number(it.upstreamAmount) : null,
        failReason: it.failReason,
        paidAt: it.paidAt,
        deliveredAt: it.deliveredAt,
        createdAt: it.createdAt,
      })),
    };
  }

  /** 后台手动重发（PAID/FAILED → 再调三方） */
  async adminRetryFulfill(orderNo: string) {
    const order = await this.prisma.forgeOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      order.status !== ForgeOrderStatus.PAID &&
      order.status !== ForgeOrderStatus.FAILED
    ) {
      throw new BadRequestException(`订单状态 ${order.status} 不允许重发`);
    }
    // 先重置回 PAID
    if (order.status === ForgeOrderStatus.FAILED) {
      await this.prisma.forgeOrder.update({
        where: { orderNo },
        data: { status: ForgeOrderStatus.PAID, failReason: null },
      });
    }
    await this.fulfillOrder(orderNo);
    return this.detail(orderNo);
  }

  /** 超时未付订单 → EXPIRED */
  async expirePendingOrders() {
    const r = await this.prisma.forgeOrder.updateMany({
      where: {
        status: ForgeOrderStatus.PENDING,
        paymentMethod: ForgePaymentMethod.ALIPAY,
        expireAt: { lt: new Date() },
      },
      data: { status: ForgeOrderStatus.EXPIRED },
    });
    if (r.count) {
      this.logger.log(`expired ${r.count} pending forge orders`);
    }
    return r.count;
  }

  private validateQty(q: number) {
    if (!Number.isInteger(q) || q <= 0 || q > 10) {
      throw new BadRequestException('数量必须为 1-10');
    }
  }
}
