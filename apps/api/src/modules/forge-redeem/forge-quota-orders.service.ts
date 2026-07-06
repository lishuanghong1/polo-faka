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
import {
  ForgeApiError,
  ForgeNetworkError,
  ForgeOpenapiService,
} from '../forge-openapi/forge-openapi.service';
import { encryptString, decryptString, isEncrypted } from '../../common/crypto.util';
import { ForgeQuotaPackagesService } from './forge-quota-packages.service';
import { VipService } from '../vip/vip.service';
import { PointsService } from '../points/points.service';

const orderNano = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

function makeOrderNo(): string {
  return `Q${dayjs().format('YYYYMMDDHHmmss')}${orderNano()}`;
}

function makeCustomerRef(orderNo: string): string {
  const salt = process.env.POOL_ENCRYPTION_KEY || process.env.JWT_SECRET || 'polo_faka';
  return createHash('sha256').update(`${orderNo}::${salt}`).digest('hex').slice(0, 32);
}

function normalizeRedeemCode(value: string): string {
  return String(value || '').trim().toUpperCase();
}

/** 三方兑换码状态（v1.1.1 起三态） */
export type QuotaCodeStatus = 'unused' | 'used' | 'voided';

/** upstreamData 里存的单个码结构（加密 JSON 数组的元素） */
export interface StoredQuotaCode {
  code: string;
  redeem_url: string | null;
  status: QuotaCodeStatus;
  used_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

function normalizeCode(raw: any): StoredQuotaCode {
  const status = raw?.status === 'used' || raw?.status === 'voided' ? raw.status : 'unused';
  return {
    code: String(raw?.code || ''),
    redeem_url: raw?.redeem_url ?? null,
    status,
    used_at: raw?.used_at ?? null,
    voided_at: raw?.voided_at ?? null,
    void_reason: raw?.void_reason ?? null,
  };
}

function countCodes(codes: StoredQuotaCode[]) {
  let used = 0;
  let voided = 0;
  for (const c of codes) {
    if (c.status === 'used') used += 1;
    else if (c.status === 'voided') voided += 1;
  }
  return { used, voided };
}

/** 刷新节流：codesSyncedAt 距今 < 10s 时跳过上游请求 */
const CODES_SYNC_MIN_INTERVAL_MS = 10_000;

/**
 * 额度包购码订单核心服务（对应三方 §6.8 quota-orders / quota-codes）。
 * 支付路径与成品号订单一致：REDEEM / BALANCE / POINTS 同步发货，ALIPAY 走 notify。
 * 交付物是三方返回的兑换码（加密入库），买家拿码到 forge 官网核销。
 */
@Injectable()
export class ForgeQuotaOrdersService {
  private readonly logger = new Logger(ForgeQuotaOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private forge: ForgeOpenapiService,
    private packages: ForgeQuotaPackagesService,
    private vip: VipService,
    private points: PointsService,
  ) {}

  /** 兑换码路径：扣本站余额码 + 立即调三方购码 */
  async createByRedeemCode(input: {
    code: string;
    packageKey: string;
    quantity: number;
    contact?: string;
    ip?: string;
    userId?: number | null;
  }) {
    const rawCode = normalizeRedeemCode(input.code);
    if (!rawCode) throw new BadRequestException('请填写兑换码');

    const pkg = await this.packages.getEnabledOrThrow(input.packageKey);
    this.validateQty(input.quantity);
    const displayPrice = Number(pkg.displayPrice);
    const totalAmount = +(displayPrice * input.quantity).toFixed(2);

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
      await tx.forgeQuotaOrder.create({
        data: {
          orderNo,
          userId: input.userId ?? null,
          redeemCodeId: code.id,
          paymentMethod: ForgePaymentMethod.REDEEM,
          packageKey: pkg.packageKey,
          packageName: pkg.customName || pkg.name,
          quotaUsd: pkg.quotaUsd,
          lineKey: pkg.lineKey,
          quantity: input.quantity,
          displayPrice: new Prisma.Decimal(displayPrice),
          totalAmount: new Prisma.Decimal(totalAmount),
          contact: input.contact?.slice(0, 128),
          customerRef: makeCustomerRef(orderNo),
          status: ForgeOrderStatus.PAID,
          paidAt: new Date(),
          ip: input.ip,
        },
      });
      return { orderNo, codeRow: code };
    });

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
      throw e;
    }
    return this.detail(orderNo);
  }

  /** 余额路径：原子扣余额 + 立即调三方购码，失败自动退回 */
  async createByBalance(input: {
    packageKey: string;
    quantity: number;
    contact?: string;
    ip?: string;
    userId: number;
  }) {
    if (!input.userId) throw new BadRequestException('余额支付需要登录');
    const pkg = await this.packages.getEnabledOrThrow(input.packageKey);
    this.validateQty(input.quantity);
    const displayPrice = Number(pkg.displayPrice);
    const totalAmount = +(displayPrice * input.quantity).toFixed(2);
    const vipResult = await this.vip.applyDiscount(
      input.userId,
      'FORGE_QUOTA',
      pkg.packageKey,
      totalAmount,
    );
    const payAmount = vipResult.payAmount;
    const payAmountDec = new Prisma.Decimal(payAmount);

    const u = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!u) throw new NotFoundException('用户不存在');
    if (u.status !== 'ACTIVE') throw new BadRequestException('账号已被禁用');
    if (Number(u.balance) < payAmount) {
      throw new BadRequestException('余额不足，请先充值');
    }

    const orderNo = makeOrderNo();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.user.updateMany({
        where: { id: input.userId, balance: { gte: payAmountDec } },
        data: { balance: { decrement: payAmountDec } },
      });
      if (r.count === 0) throw new BadRequestException('余额不足');

      const after = await tx.user.findUnique({
        where: { id: input.userId },
        select: { balance: true },
      });
      await tx.balanceLog.create({
        data: {
          userId: input.userId,
          amount: payAmountDec.negated(),
          balance: new Prisma.Decimal(Number(after?.balance ?? 0)),
          type: 'CONSUME',
          note: `订单 ${orderNo}`,
          refOrder: orderNo,
        },
      });

      await tx.forgeQuotaOrder.create({
        data: {
          orderNo,
          userId: input.userId,
          paymentMethod: ForgePaymentMethod.BALANCE,
          packageKey: pkg.packageKey,
          packageName: pkg.customName || pkg.name,
          quotaUsd: pkg.quotaUsd,
          lineKey: pkg.lineKey,
          quantity: input.quantity,
          displayPrice: new Prisma.Decimal(displayPrice),
          totalAmount: new Prisma.Decimal(totalAmount),
          discountAmount: new Prisma.Decimal(vipResult.discountAmount),
          payAmount: payAmountDec,
          vipTier: vipResult.tier,
          contact: input.contact?.slice(0, 128),
          customerRef: makeCustomerRef(orderNo),
          status: ForgeOrderStatus.PAID,
          paidAt: new Date(),
          ip: input.ip,
        },
      });
    });

    try {
      await this.fulfillOrder(orderNo);
    } catch (e) {
      await this.refundBalanceForFailedOrder(orderNo).catch((err) => {
        this.logger.error(
          `refund balance for failed quota order ${orderNo}: ${(err as Error).message}`,
        );
      });
      throw e;
    }
    return this.detail(orderNo);
  }

  /** 积分路径：与成品号一致（1 积分 = 1 元，折后向上取整） */
  async createByPoints(input: {
    packageKey: string;
    quantity: number;
    contact?: string;
    ip?: string;
    userId: number;
  }) {
    if (!input.userId) throw new BadRequestException('积分支付需要登录');
    const pkg = await this.packages.getEnabledOrThrow(input.packageKey);
    if (!pkg.pointsPayEnabled) {
      throw new BadRequestException('该额度包暂不支持积分支付');
    }
    this.validateQty(input.quantity);
    const displayPrice = Number(pkg.displayPrice);
    const totalAmount = +(displayPrice * input.quantity).toFixed(2);
    const vipResult = await this.vip.applyDiscount(
      input.userId,
      'FORGE_QUOTA',
      pkg.packageKey,
      totalAmount,
    );
    const payAmount = vipResult.payAmount;
    const pointsUsed = this.points.pointsRequiredForAmount(payAmount);

    const u = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, status: true, points: true },
    });
    if (!u) throw new NotFoundException('用户不存在');
    if (u.status !== 'ACTIVE') throw new BadRequestException('账号已被禁用');
    if (u.points < pointsUsed) {
      throw new BadRequestException(`积分不足，还差 ${pointsUsed - u.points} 积分`);
    }

    const orderNo = makeOrderNo();
    await this.prisma.$transaction(async (tx) => {
      await this.points.deductForOrder(tx, input.userId, orderNo, pointsUsed);
      await tx.forgeQuotaOrder.create({
        data: {
          orderNo,
          userId: input.userId,
          paymentMethod: ForgePaymentMethod.POINTS,
          packageKey: pkg.packageKey,
          packageName: pkg.customName || pkg.name,
          quotaUsd: pkg.quotaUsd,
          lineKey: pkg.lineKey,
          quantity: input.quantity,
          displayPrice: new Prisma.Decimal(displayPrice),
          totalAmount: new Prisma.Decimal(totalAmount),
          discountAmount: new Prisma.Decimal(vipResult.discountAmount),
          payAmount: new Prisma.Decimal(payAmount),
          pointsUsed,
          vipTier: vipResult.tier,
          contact: input.contact?.slice(0, 128),
          customerRef: makeCustomerRef(orderNo),
          status: ForgeOrderStatus.PAID,
          paidAt: new Date(),
          ip: input.ip,
        },
      });
    });

    try {
      await this.fulfillOrder(orderNo);
    } catch (e) {
      await this.refundPointsForFailedOrder(orderNo).catch((err) => {
        this.logger.error(
          `refund points for failed quota order ${orderNo}: ${(err as Error).message}`,
        );
      });
      throw e;
    }
    return this.detail(orderNo);
  }

  /** 支付宝路径：创建 PENDING 订单，等待 notify 触发 fulfillOrder */
  async createForAlipay(input: {
    packageKey: string;
    quantity: number;
    contact?: string;
    ip?: string;
    userId?: number | null;
  }) {
    const pkg = await this.packages.getEnabledOrThrow(input.packageKey);
    this.validateQty(input.quantity);
    const displayPrice = Number(pkg.displayPrice);
    const totalAmount = +(displayPrice * input.quantity).toFixed(2);
    const vipResult = await this.vip.applyDiscount(
      input.userId ?? null,
      'FORGE_QUOTA',
      pkg.packageKey,
      totalAmount,
    );

    const orderNo = makeOrderNo();
    await this.prisma.forgeQuotaOrder.create({
      data: {
        orderNo,
        userId: input.userId ?? null,
        paymentMethod: ForgePaymentMethod.ALIPAY,
        packageKey: pkg.packageKey,
        packageName: pkg.customName || pkg.name,
        quotaUsd: pkg.quotaUsd,
        lineKey: pkg.lineKey,
        quantity: input.quantity,
        displayPrice: new Prisma.Decimal(displayPrice),
        totalAmount: new Prisma.Decimal(totalAmount),
        discountAmount: new Prisma.Decimal(vipResult.discountAmount),
        payAmount: new Prisma.Decimal(vipResult.payAmount),
        vipTier: vipResult.tier,
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
   * 支付状态推进（PENDING → PAID），由 alipay notify 调用。
   * 返回 'recorded'（应触发发货）或 'already'（幂等命中）。
   */
  async markPaid(
    orderNo: string,
    tradeNo: string,
    paidAmount: number,
    buyerLogonId?: string,
  ): Promise<'recorded' | 'already'> {
    const order = await this.prisma.forgeQuotaOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.paymentMethod !== ForgePaymentMethod.ALIPAY) {
      throw new BadRequestException('订单不是支付宝订单');
    }
    const expectAmount =
      order.payAmount !== null ? Number(order.payAmount) : Number(order.totalAmount);
    if (Math.abs(expectAmount - paidAmount) > 0.01) {
      throw new BadRequestException(
        `金额不一致：订单 ¥${expectAmount}，支付 ¥${paidAmount}`,
      );
    }
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

    await this.prisma.forgeQuotaOrder.update({
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

  /** 异步触发上游购码（notify 场景，不阻塞响应） */
  fulfillAsync(orderNo: string): void {
    setImmediate(() => {
      this.fulfillOrder(orderNo).catch((e) => {
        this.logger.error(`fulfillAsync quota ${orderNo} failed: ${(e as Error).message}`);
      });
    });
  }

  /**
   * 调三方购码（POST /openapi/v1/quota-orders），codes 加密入库，标 DELIVERED。
   * 幂等：我方 orderNo 即 external_order_id，重试命中三方幂等返回原单（含码状态）。
   */
  async fulfillOrder(orderNo: string) {
    const order = await this.prisma.forgeQuotaOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === ForgeOrderStatus.DELIVERED) return;
    if (
      order.status !== ForgeOrderStatus.PAID &&
      order.status !== ForgeOrderStatus.FAILED
    ) {
      throw new BadRequestException(`订单状态 ${order.status} 不允许发货`);
    }

    try {
      const r = await this.forge.request<any>('POST', '/openapi/v1/quota-orders', {
        package_key: order.packageKey,
        quantity: order.quantity,
        external_order_id: order.orderNo,
        customer_ref: order.customerRef,
      });
      const upstream = r.data || {};
      // 首次成功 codes 仅 {code, redeem_url}；幂等重放会带 status 等字段，统一归一化
      const codes: StoredQuotaCode[] = Array.isArray(upstream.codes)
        ? upstream.codes.map(normalizeCode)
        : [];
      const { used, voided } = countCodes(codes);
      const encrypted = encryptString(JSON.stringify(codes));
      await this.prisma.$transaction(async (tx) => {
        await tx.forgeQuotaOrder.update({
          where: { orderNo },
          data: {
            status: ForgeOrderStatus.DELIVERED,
            upstreamOrderNo: upstream.order_no,
            upstreamBatchNo: upstream.batch_no,
            upstreamRequestId: r.requestId,
            upstreamAmount:
              upstream.amount !== undefined ? new Prisma.Decimal(upstream.amount) : null,
            upstreamData: encrypted,
            usedCount: used,
            voidedCount: voided,
            codesSyncedAt: new Date(),
            deliveredAt: new Date(),
            failReason: null,
          },
        });
        await this.points.settleDeliveredForgeQuotaOrder(tx, orderNo);
      });
    } catch (e) {
      let failCode: string;
      let failMsg: string;
      if (e instanceof ForgeApiError) {
        failCode = e.code;
        failMsg = ForgeOpenapiService.friendlyMessage(e.code, e.upstreamMessage);
      } else if (e instanceof ForgeNetworkError) {
        failCode = 'NETWORK_ERROR';
        failMsg = e.detail;
      } else {
        failCode = 'NETWORK_ERROR';
        failMsg = (e as Error)?.message || '上游服务暂时不可用';
      }

      await this.prisma.forgeQuotaOrder.update({
        where: { orderNo },
        data: {
          status: ForgeOrderStatus.FAILED,
          failReason: `${failCode}: ${failMsg}`.slice(0, 500),
        },
      });
      throw ForgeOpenapiService.toHttpException(e);
    }
  }

  /** 上游购码失败时退回余额（幂等，仅 BALANCE + FAILED） */
  private async refundBalanceForFailedOrder(orderNo: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.forgeQuotaOrder.findUnique({ where: { orderNo } });
      if (!o || !o.userId) return;
      if (o.paymentMethod !== ForgePaymentMethod.BALANCE) return;
      if (o.status !== ForgeOrderStatus.FAILED) return;

      const exists = await tx.balanceLog.findFirst({
        where: { refOrder: orderNo, type: 'REFUND' },
      });
      if (exists) return;

      const refundAmount = o.payAmount !== null ? Number(o.payAmount) : Number(o.totalAmount);
      const amountDec = new Prisma.Decimal(refundAmount);
      const u = await tx.user.update({
        where: { id: o.userId },
        data: { balance: { increment: amountDec } },
      });
      await tx.balanceLog.create({
        data: {
          userId: o.userId,
          amount: amountDec,
          balance: new Prisma.Decimal(Number(u.balance)),
          type: 'REFUND',
          note: `发货失败退回 ${orderNo}`,
          refOrder: orderNo,
        },
      });
      await tx.forgeQuotaOrder.update({
        where: { orderNo },
        data: {
          status: ForgeOrderStatus.REFUNDED,
          refundAmount: amountDec,
          refundedAt: new Date(),
          refundReason: '上游发货失败 · 系统自动退回余额',
        },
      });
    });
  }

  private async refundPointsForFailedOrder(orderNo: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.forgeQuotaOrder.findUnique({ where: { orderNo } });
      if (!o || !o.userId) return;
      if (o.paymentMethod !== ForgePaymentMethod.POINTS) return;
      if (o.status !== ForgeOrderStatus.FAILED) return;
      if (!o.pointsUsed) return;

      const refunded = await this.points.refundDeductedPoints(
        tx,
        o.userId,
        orderNo,
        o.pointsUsed,
      );
      if (!refunded) return;

      await tx.forgeQuotaOrder.update({
        where: { orderNo },
        data: {
          status: ForgeOrderStatus.REFUNDED,
          refundedAt: new Date(),
          refundReason: '上游发货失败 · 系统自动退回积分',
        },
      });
    });
  }

  /**
   * 从三方拉当前码状态（GET /quota-orders/{order_no}），更新加密码表 + 统计。
   * 有 10s 节流：买家/管理员短时间重复点刷新不会打爆上游。
   */
  async refreshCodes(orderNo: string, force = false) {
    const order = await this.prisma.forgeQuotaOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== ForgeOrderStatus.DELIVERED || !order.upstreamOrderNo) {
      return this.detail(orderNo);
    }
    if (
      !force &&
      order.codesSyncedAt &&
      Date.now() - order.codesSyncedAt.getTime() < CODES_SYNC_MIN_INTERVAL_MS
    ) {
      return this.detail(orderNo);
    }

    try {
      const r = await this.forge.request<any>(
        'GET',
        `/openapi/v1/quota-orders/${encodeURIComponent(order.upstreamOrderNo)}`,
      );
      const upstream = r.data || {};
      if (Array.isArray(upstream.codes) && upstream.codes.length) {
        const codes = upstream.codes.map(normalizeCode);
        const { used, voided } = countCodes(codes);
        await this.prisma.forgeQuotaOrder.update({
          where: { orderNo },
          data: {
            upstreamData: encryptString(JSON.stringify(codes)),
            usedCount: used,
            voidedCount: voided,
            codesSyncedAt: new Date(),
          },
        });
      }
    } catch (e) {
      // 刷新失败不致命：保留本地快照，把错误往上抛给调用方展示
      throw ForgeOpenapiService.toHttpException(e);
    }
    return this.detail(orderNo);
  }

  /** 订单详情 + codes 解密（用户/管理员都用） */
  async detail(orderNo: string) {
    const order = await this.prisma.forgeQuotaOrder.findUnique({
      where: { orderNo },
      include: { redeemCode: { select: { code: true } } },
    });
    if (!order) throw new NotFoundException('订单不存在');

    let codes: StoredQuotaCode[] = [];
    if (order.upstreamData) {
      try {
        const raw = isEncrypted(order.upstreamData)
          ? decryptString(order.upstreamData)
          : order.upstreamData;
        codes = (JSON.parse(raw) || []).map(normalizeCode);
      } catch (e) {
        this.logger.error(`decrypt quota ${orderNo} codes failed: ${(e as Error).message}`);
      }
    }

    return {
      orderNo: order.orderNo,
      paymentMethod: order.paymentMethod,
      packageKey: order.packageKey,
      packageName: order.packageName,
      quotaUsd: Number(order.quotaUsd),
      lineKey: order.lineKey,
      quantity: order.quantity,
      displayPrice: Number(order.displayPrice),
      totalAmount: Number(order.totalAmount),
      discountAmount: Number(order.discountAmount ?? 0),
      payAmount:
        order.payAmount !== null ? Number(order.payAmount) : Number(order.totalAmount),
      vipTier: order.vipTier,
      contact: order.contact,
      status: order.status,
      thirdTradeNo: order.thirdTradeNo,
      paidAt: order.paidAt,
      expireAt: order.expireAt,
      upstreamOrderNo: order.upstreamOrderNo,
      upstreamBatchNo: order.upstreamBatchNo,
      upstreamAmount:
        order.upstreamAmount !== null ? Number(order.upstreamAmount) : null,
      usedCount: order.usedCount,
      voidedCount: order.voidedCount,
      codesSyncedAt: order.codesSyncedAt,
      deliveredAt: order.deliveredAt,
      failReason: order.failReason,
      createdAt: order.createdAt,
      redeemCode: order.redeemCode?.code ?? null,
      codes,
    };
  }

  /** 管理员详情：补齐 PII / 退款信息 + 下单用户概要 */
  async adminDetail(orderNo: string) {
    const detail = await this.detail(orderNo);
    const meta = await this.prisma.forgeQuotaOrder.findUnique({
      where: { orderNo },
      select: {
        userId: true,
        ip: true,
        buyerLogonId: true,
        refundAmount: true,
        refundReason: true,
        refundedAt: true,
      },
    });
    const user = meta?.userId
      ? await this.prisma.user.findUnique({
          where: { id: meta.userId },
          select: { id: true, username: true, nickname: true, email: true, vipTier: true },
        })
      : null;
    return {
      ...detail,
      userId: meta?.userId ?? null,
      ip: meta?.ip ?? null,
      buyerLogonId: meta?.buyerLogonId ?? null,
      refundAmount: meta?.refundAmount != null ? Number(meta.refundAmount) : null,
      refundReason: meta?.refundReason ?? null,
      refundedAt: meta?.refundedAt ?? null,
      user,
    };
  }

  /**
   * 公开查单：订单有 contact 时需校验（与成品号订单一致的防爆破策略）。
   * 买家侧只给兑换码本身，不下发 redeem_url（不向终端买家暴露上游官网地址）；
   * 管理端走 adminDetail 仍能看到完整链接用于售后。
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
    return {
      ...order,
      codes: order.codes.map(({ redeem_url: _redeemUrl, ...rest }) => rest),
    };
  }

  /** 用户中心：登录用户的额度包订单 */
  async listMine(userId: number, page = 1, pageSize = 20) {
    if (!userId || typeof userId !== 'number') {
      throw new BadRequestException('未登录');
    }
    const where: Prisma.ForgeQuotaOrderWhereInput = { userId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.forgeQuotaOrder.count({ where }),
      this.prisma.forgeQuotaOrder.findMany({
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
        packageKey: it.packageKey,
        packageName: it.packageName,
        quotaUsd: Number(it.quotaUsd),
        quantity: it.quantity,
        displayPrice: Number(it.displayPrice),
        totalAmount: Number(it.totalAmount),
        discountAmount: Number(it.discountAmount ?? 0),
        payAmount:
          it.payAmount !== null ? Number(it.payAmount) : Number(it.totalAmount),
        vipTier: it.vipTier,
        contact: it.contact,
        paymentMethod: it.paymentMethod,
        status: it.status,
        usedCount: it.usedCount,
        voidedCount: it.voidedCount,
        paidAt: it.paidAt,
        deliveredAt: it.deliveredAt,
        createdAt: it.createdAt,
      })),
    };
  }

  /** Admin 列表 */
  async listAdmin(query: {
    page?: number;
    pageSize?: number;
    status?: ForgeOrderStatus;
    paymentMethod?: ForgePaymentMethod;
    packageKey?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const where: Prisma.ForgeQuotaOrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.packageKey) where.packageKey = query.packageKey;
    if (query.keyword) {
      where.OR = [
        { orderNo: { contains: query.keyword } },
        { upstreamOrderNo: { contains: query.keyword } },
        { upstreamBatchNo: { contains: query.keyword } },
        { contact: { contains: query.keyword } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.forgeQuotaOrder.count({ where }),
      this.prisma.forgeQuotaOrder.findMany({
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
        packageKey: it.packageKey,
        packageName: it.packageName,
        quotaUsd: Number(it.quotaUsd),
        quantity: it.quantity,
        displayPrice: Number(it.displayPrice),
        totalAmount: Number(it.totalAmount),
        discountAmount: Number(it.discountAmount ?? 0),
        payAmount:
          it.payAmount !== null ? Number(it.payAmount) : Number(it.totalAmount),
        vipTier: it.vipTier,
        contact: it.contact,
        status: it.status,
        usedCount: it.usedCount,
        voidedCount: it.voidedCount,
        buyerLogonId: it.buyerLogonId,
        thirdTradeNo: it.thirdTradeNo,
        upstreamOrderNo: it.upstreamOrderNo,
        upstreamBatchNo: it.upstreamBatchNo,
        upstreamAmount: it.upstreamAmount !== null ? Number(it.upstreamAmount) : null,
        failReason: it.failReason,
        paidAt: it.paidAt,
        deliveredAt: it.deliveredAt,
        createdAt: it.createdAt,
      })),
    };
  }

  /** 后台手动重发（PAID/FAILED → 再调三方；命中三方幂等不会重复扣款） */
  async adminRetryFulfill(orderNo: string) {
    const order = await this.prisma.forgeQuotaOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      order.status !== ForgeOrderStatus.PAID &&
      order.status !== ForgeOrderStatus.FAILED
    ) {
      throw new BadRequestException(`订单状态 ${order.status} 不允许重发`);
    }
    if (order.status === ForgeOrderStatus.FAILED) {
      await this.prisma.forgeQuotaOrder.update({
        where: { orderNo },
        data: { status: ForgeOrderStatus.PAID, failReason: null },
      });
    }
    await this.fulfillOrder(orderNo);
    return this.detail(orderNo);
  }

  /** 管理员：删除额度包订单（已支付/已发货需先退款） */
  async adminDelete(orderNo: string) {
    const order = await this.prisma.forgeQuotaOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      order.status === ForgeOrderStatus.PAID ||
      order.status === ForgeOrderStatus.DELIVERED
    ) {
      throw new BadRequestException(
        '已支付/已发货的订单不可直接删除，请先退款再删除',
      );
    }
    await this.prisma.forgeQuotaOrder.delete({ where: { orderNo } });
    return { ok: true };
  }

  /** 超时未付订单 → EXPIRED */
  async expirePendingOrders() {
    const r = await this.prisma.forgeQuotaOrder.updateMany({
      where: {
        status: ForgeOrderStatus.PENDING,
        paymentMethod: ForgePaymentMethod.ALIPAY,
        expireAt: { lt: new Date() },
      },
      data: { status: ForgeOrderStatus.EXPIRED },
    });
    if (r.count) {
      this.logger.log(`expired ${r.count} pending forge quota orders`);
    }
    return r.count;
  }

  // ── 兑换码工具（admin 售后用） ─────────────────────────────

  /** 单码状态查询（GET /quota-codes/{code}），只能查本代理出库的码 */
  async adminQueryCode(code: string) {
    const c = normalizeRedeemCode(code);
    if (!c) throw new BadRequestException('请输入兑换码');
    try {
      const r = await this.forge.request<any>(
        'GET',
        `/openapi/v1/quota-codes/${encodeURIComponent(c)}`,
      );
      return r.data;
    } catch (e) {
      throw ForgeOpenapiService.toHttpException(e);
    }
  }

  /**
   * 自助作废兑换码（POST /quota-codes/void）。
   * 仅 unused 的码会被作废并按出库单价退回代理余额（quota_code_refund）。
   * 作废后同步刷新本地受影响订单的码状态。
   */
  async adminVoidCodes(codes: string[], reason?: string) {
    const list = Array.from(
      new Set((codes || []).map(normalizeRedeemCode).filter(Boolean)),
    );
    if (!list.length) throw new BadRequestException('请填写要作废的兑换码');
    if (list.length > 100) throw new BadRequestException('单次最多作废 100 个码');

    let data: any;
    try {
      const r = await this.forge.request<any>('POST', '/openapi/v1/quota-codes/void', {
        codes: list,
        ...(reason ? { reason: reason.slice(0, 180) } : {}),
      });
      data = r.raw?.data ?? r.data ?? {};
      data.message = r.raw?.message;
    } catch (e) {
      // 全部码都没作废成功（HTTP 404 CODE_NOT_FOUND）：把 skipped 明细透出给前端
      if (e instanceof ForgeApiError && e.code === 'CODE_NOT_FOUND') {
        return {
          voided: [],
          voidedCount: 0,
          skipped: e.data?.skipped ?? list.map((code) => ({ code, reason: e.upstreamMessage })),
          refunded: [],
          refundSkipped: [],
          refundTotal: 0,
          balanceAfter: null,
          message: ForgeOpenapiService.friendlyMessage(e.code, e.upstreamMessage),
        };
      }
      throw ForgeOpenapiService.toHttpException(e);
    }

    // 同步本地：作废的码所在的出库订单刷新一遍状态
    const upstreamOrderNos = new Set<string>();
    for (const g of [...(data.refunded || []), ...(data.refund_skipped || [])]) {
      if (g?.order_no) upstreamOrderNos.add(String(g.order_no));
    }
    for (const no of upstreamOrderNos) {
      const local = await this.prisma.forgeQuotaOrder.findFirst({
        where: { upstreamOrderNo: no },
        select: { orderNo: true },
      });
      if (local) {
        await this.refreshCodes(local.orderNo, true).catch((e) => {
          this.logger.warn(
            `refresh codes after void for ${local.orderNo}: ${(e as Error).message}`,
          );
        });
      }
    }

    return {
      voided: data.voided || [],
      voidedCount: data.voided_count ?? (data.voided || []).length,
      skipped: data.skipped || [],
      refunded: data.refunded || [],
      refundSkipped: data.refund_skipped || [],
      refundTotal: Number(data.refund_total ?? 0),
      balanceAfter: data.balance_after !== undefined ? Number(data.balance_after) : null,
      message: data.message || '作废完成',
    };
  }

  private validateQty(q: number) {
    if (!Number.isInteger(q) || q <= 0 || q > 100) {
      throw new BadRequestException('数量必须为 1-100');
    }
  }
}
