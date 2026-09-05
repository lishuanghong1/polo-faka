import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, CursorSellPurchase, CursorSellSale } from '@prisma/client';
import Redis from 'ioredis';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { decryptString, encryptString, maskSecret } from '../../common/crypto.util';
import { PointsService } from '../points/points.service';
import { WeComService } from '../wecom/wecom.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { CursorSellApiError, CursorSellNetworkError, CursorSellService } from './cursor-sell.service';
import { CursorSellCatalogService } from './cursor-sell-catalog.service';
import {
  UpstreamAccountSale,
  UpstreamBuyResult,
  UpstreamExtractCard,
  buildCardContent,
  classifySale,
  extractAccountSales,
  pickCredentials,
} from './cursor-sell.types';

const keyNano = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

/** OUT_OF_STOCK / UPSTREAM_UNAVAILABLE 这类可重试错误的最大自动重试次数（cron 每 5 分钟一次） */
const MAX_RETRYABLE_ATTEMPTS = 12;
/** 网络层错误（结果未知）连续多少次后推企微提醒 */
const NETWORK_NOTIFY_AFTER = 3;

export type PushDestination = 'NONE' | 'CARD_POOL' | 'WAREHOUSE';

type OrderWithProduct = Prisma.OrderGetPayload<{ include: { product: true } }>;

export interface SaleView {
  id: number;
  purchaseId: number;
  orderNo: string | null;
  cardKeyId: number | null;
  saleId: number | null;
  extractCardId: number | null;
  kind: string;
  productCode: string;
  tier: string | null;
  email: string | null;
  making: boolean;
  loginApprove: boolean;
  loginApprovedAt: Date | null;
  warrantyUntil: Date | null;
  soldAt: Date | null;
  credentials: Record<string, string>;
  usage: unknown;
  usageAt: Date | null;
  createdAt: Date;
}

/**
 * Team 渠道采购 / 发货 / 回填。
 *
 * 幂等：一次 buy-account = 一条 cursor_sell_purchases，Idempotency-Key 存库；
 *   - 订单发货：优先复用该订单 PENDING 的采购单（同一 key 重试，永不重复扣费）
 *   - 结果未知（网络错误）的采购单永远停在 PENDING，只能同 key 重试，不允许换 key 重买
 *   - 上游明确失败（余额不足 / 下架 / 达到重试上限）才标 FAILED；之后重新发货会开新采购单（新 key）
 */
@Injectable()
export class CursorSellFulfilService {
  private readonly logger = new Logger(CursorSellFulfilService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private api: CursorSellService,
    private catalog: CursorSellCatalogService,
    private points: PointsService,
    private wecom: WeComService,
    private warehouse: WarehouseService,
  ) {}

  // ─────────────────────────── 订单自动发货 ───────────────────────────

  /**
   * 由 OrdersService.markPaidAndDeliver 在持有订单锁时调用。
   * 成功时把订单推进到 DELIVERED；失败/开通中时订单留在 PAID，原因写在采购单上。
   */
  async deliverOrder(order: OrderWithProduct): Promise<void> {
    const sku = await this.prisma.sku.findUnique({ where: { id: order.skuId } });
    const attrs = (sku?.attrs && typeof sku.attrs === 'object' ? sku.attrs : {}) as Record<string, unknown>;
    const code = String(attrs.cursorSellCode || '').trim();
    const extractSplit = !!attrs.cursorSellExtractSplit;
    if (!code) {
      await this.notify(
        `## ⚠️ Team 渠道发货失败\n> 订单 ${order.orderNo}\n\n规格「${order.skuName}」没有绑定渠道商品，请到后台商品编辑里选择。`,
      );
      return;
    }

    let product = await this.prisma.cursorSellProduct.findUnique({ where: { code } });
    if (!product) {
      try {
        await this.catalog.sync();
      } catch (e) {
        this.logger.warn(`sync before deliver failed: ${(e as Error).message}`);
      }
      product = await this.prisma.cursorSellProduct.findUnique({ where: { code } });
    }
    if (!product) {
      await this.notify(
        `## ⚠️ Team 渠道发货失败\n> 订单 ${order.orderNo}\n\n渠道商品 \`${code}\` 不存在（可能已下架），请重新同步商品并检查规格绑定。`,
      );
      return;
    }

    const delivered = await this.prisma.cardKey.count({ where: { orderNo: order.orderNo } });
    const need = order.quantity - delivered;
    if (need <= 0) {
      await this.finalizeOrderIfReady(order.orderNo);
      return;
    }

    // 现做中的采购单交给 cron 轮询，这里不重复下单
    const making = await this.prisma.cursorSellPurchase.findFirst({
      where: { orderNo: order.orderNo, status: 'MAKING' },
    });
    if (making) return;

    let purchase = await this.prisma.cursorSellPurchase.findFirst({
      where: { orderNo: order.orderNo, status: 'PENDING' },
      orderBy: { id: 'desc' },
    });
    if (purchase && purchase.productCode !== code) {
      // 规格换绑了商品：旧单没成交过，直接作废，开新单
      await this.prisma.cursorSellPurchase.update({
        where: { id: purchase.id },
        data: { status: 'FAILED', failReason: '规格已换绑其它渠道商品，本单作废' },
      });
      purchase = null;
    }
    if (!purchase) {
      const seq = (await this.prisma.cursorSellPurchase.count({ where: { orderNo: order.orderNo } })) + 1;
      purchase = await this.prisma.cursorSellPurchase.create({
        data: {
          idempotencyKey: `polo:${order.orderNo}:${code}:${seq}`,
          source: 'ORDER',
          orderNo: order.orderNo,
          productCode: code,
          productTitle: product.title,
          qty: need,
          extractSplit: product.extractOnly ? extractSplit : false,
          status: 'PENDING',
          costCents: product.priceCents * need,
        },
      });
    }

    await this.executePurchase(purchase, { orderNo: order.orderNo, order });
  }

  /**
   * cron / 后台重试入口：自己拿订单锁，避免与 OrdersService 并发发货。
   */
  async redeliverOrder(orderNo: string): Promise<void> {
    const lockKey = `lock:order:${orderNo}`;
    const got = await this.redis.set(lockKey, '1', 'EX', 60, 'NX').catch(() => 'OK');
    if (got !== 'OK') return;
    try {
      const order = await this.prisma.order.findUnique({
        where: { orderNo },
        include: { product: true },
      });
      if (!order || order.product.deliveryType !== 'CURSOR_SELL') return;
      if (order.status !== 'PAID') return;
      await this.deliverOrder(order);
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  // ─────────────────────────── 后台手动采购 ───────────────────────────

  async manualPurchase(input: {
    code: string;
    qty: number;
    extractSplit?: boolean;
    operatorId?: number | null;
    destination?: PushDestination;
    skuId?: number | null;
  }) {
    const code = input.code.trim();
    const qty = Math.max(1, Math.min(50, Math.floor(Number(input.qty) || 1)));
    const product = await this.prisma.cursorSellProduct.findUnique({ where: { code } });
    if (!product) throw new NotFoundException('渠道商品不存在，请先同步商品');
    if (!product.active) throw new BadRequestException('该渠道商品已下架');
    if (product.ondemandTeam && qty > 5) throw new BadRequestException('现做 Team 单次最多 5 个');
    const destination = input.destination || 'NONE';
    if (destination === 'CARD_POOL' && !input.skuId) throw new BadRequestException('入卡密池需要选择本站规格');

    const purchase = await this.prisma.cursorSellPurchase.create({
      data: {
        idempotencyKey: `polo:manual:${keyNano()}`,
        source: 'MANUAL',
        productCode: code,
        productTitle: product.title,
        qty,
        extractSplit: product.extractOnly ? !!input.extractSplit : false,
        status: 'PENDING',
        costCents: product.priceCents * qty,
        operatorId: input.operatorId ?? null,
      },
    });
    const result = await this.executePurchase(purchase, { orderNo: null, order: null });
    if (result.ok && destination !== 'NONE') {
      await this.pushPurchase(purchase.id, destination, input.skuId ?? null);
    }
    return this.getPurchase(purchase.id);
  }

  /** 手动采购单重试：同 key 重放（未成交的不会重复扣费） */
  async retryPurchase(purchaseId: number) {
    const purchase = await this.prisma.cursorSellPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) throw new NotFoundException('采购单不存在');
    if (purchase.status === 'DONE') throw new BadRequestException('采购单已成交，无需重试');
    if (purchase.status === 'MAKING') throw new BadRequestException('账号开通中，请等待轮询完成');
    if (purchase.source === 'ORDER' && purchase.orderNo) {
      // 订单来源统一走订单发货入口（会复用 PENDING 单或新开单）
      if (purchase.status === 'FAILED') {
        // FAILED 单不再复用 key；把状态改回 PENDING 让发货流程复用同一 key（上游确认未成交）
        await this.prisma.cursorSellPurchase.update({
          where: { id: purchase.id },
          data: { status: 'PENDING', failReason: null, errorCode: null },
        });
      }
      await this.redeliverOrder(purchase.orderNo);
      return this.getPurchase(purchase.id);
    }
    const reset =
      purchase.status === 'FAILED'
        ? await this.prisma.cursorSellPurchase.update({
            where: { id: purchase.id },
            data: { status: 'PENDING', failReason: null, errorCode: null },
          })
        : purchase;
    await this.executePurchase(reset, { orderNo: null, order: null });
    return this.getPurchase(purchase.id);
  }

  // ─────────────────────────── 采购执行（订单 / 手动共用） ───────────────────────────

  private async executePurchase(
    purchase: CursorSellPurchase,
    ctx: { orderNo: string | null; order: OrderWithProduct | null },
  ): Promise<{ ok: boolean }> {
    const attempts = purchase.attempts + 1;
    await this.prisma.cursorSellPurchase.update({
      where: { id: purchase.id },
      data: { attempts, lastAttemptAt: new Date() },
    });

    let data: UpstreamBuyResult;
    try {
      data = await this.api.buyAccount(
        { code: purchase.productCode, qty: purchase.qty, extractSplit: purchase.extractSplit },
        purchase.idempotencyKey,
      );
    } catch (e) {
      await this.recordPurchaseFailure(purchase, attempts, e, ctx.orderNo);
      return { ok: false };
    }

    try {
      await this.applyPurchaseResult(purchase, data, ctx);
      return { ok: true };
    } catch (e) {
      // 上游已成交但本地落库异常：绝不能再换 key 重买。保留响应，标 PENDING 让同 key 重放重新落库
      this.logger.error(`apply purchase #${purchase.id} failed: ${(e as Error).message}`, (e as Error).stack);
      await this.prisma.cursorSellPurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'PENDING',
          responseEnc: encryptString(JSON.stringify(data)),
          errorCode: 'LOCAL_APPLY_ERROR',
          failReason: `上游已成交但本地落库失败：${(e as Error).message}`.slice(0, 500),
        },
      });
      await this.notify(
        `## 🚨 Team 渠道落库异常\n> 采购单 #${purchase.id}${ctx.orderNo ? ` / 订单 ${ctx.orderNo}` : ''}\n\n上游已成交，但本地写入失败：${(e as Error).message}\n请到后台「Team 渠道 → 采购单」点重试（同一幂等键，不会重复扣费）。`,
      );
      return { ok: false };
    }
  }

  private async recordPurchaseFailure(
    purchase: CursorSellPurchase,
    attempts: number,
    e: unknown,
    orderNo: string | null,
  ) {
    const label = orderNo ? `订单 ${orderNo}` : `手动采购 #${purchase.id}`;
    if (e instanceof CursorSellApiError) {
      const definitive = !e.isRetryable;
      const exhausted = e.isRetryable && attempts >= MAX_RETRYABLE_ATTEMPTS;
      const status = definitive || exhausted ? 'FAILED' : 'PENDING';
      const updated = await this.prisma.cursorSellPurchase.update({
        where: { id: purchase.id },
        data: {
          status,
          errorCode: e.errorCode,
          failReason: `${e.errorCode}: ${e.upstreamMessage || e.message}`.slice(0, 500),
        },
      });
      if (status === 'FAILED' && !updated.notifiedAt) {
        await this.notify(
          `## ⚠️ Team 渠道采购失败\n> ${label} · 商品 ${purchase.productTitle}（${purchase.productCode}）× ${purchase.qty}\n\n**原因**：${e.errorCode} ${e.upstreamMessage || ''}\n${
            e.errorCode === 'INSUFFICIENT_BALANCE'
              ? '请到后台「Team 渠道」兑换充值卡充值后，对该订单点「补发」。'
              : '请到后台处理（补发 / 换商品 / 退款）。'
          }`,
        );
        await this.prisma.cursorSellPurchase.update({
          where: { id: purchase.id },
          data: { notifiedAt: new Date() },
        });
      }
      this.logger.warn(`purchase #${purchase.id} ${label} upstream error ${e.errorCode} (attempt ${attempts}, status=${status})`);
      return;
    }
    const detail = e instanceof CursorSellNetworkError ? e.detail : (e as Error)?.message || String(e);
    const updated = await this.prisma.cursorSellPurchase.update({
      where: { id: purchase.id },
      data: {
        status: 'PENDING',
        errorCode: 'NETWORK',
        failReason: `网络错误（结果未知，将同键重试）：${detail}`.slice(0, 500),
      },
    });
    if (attempts >= NETWORK_NOTIFY_AFTER && !updated.notifiedAt) {
      await this.notify(
        `## ⚠️ Team 渠道连续 ${attempts} 次网络异常\n> ${label} · 商品 ${purchase.productTitle}\n\n${detail}\n系统会继续用同一幂等键重试；也可到后台手动重试。`,
      );
      await this.prisma.cursorSellPurchase.update({
        where: { id: purchase.id },
        data: { notifiedAt: new Date() },
      });
    }
    this.logger.warn(`purchase #${purchase.id} ${label} network error: ${detail}`);
  }

  /**
   * 把上游成交结果落库：cursor_sell_sales（+ 订单来源时写 card_keys 并推进订单）。
   * 同一采购单重放时按 saleId / extractCardId 去重，保证幂等。
   */
  private async applyPurchaseResult(
    purchase: CursorSellPurchase,
    data: UpstreamBuyResult,
    ctx: { orderNo: string | null; order: OrderWithProduct | null },
  ) {
    const kind = (data as { kind?: string }).kind || 'account';
    const accounts = extractAccountSales(data);
    const extractCards: UpstreamExtractCard[] =
      kind === 'extract' && Array.isArray((data as { extractCards?: unknown }).extractCards)
        ? ((data as { extractCards: UpstreamExtractCard[] }).extractCards)
        : [];

    if (!accounts.length && !extractCards.length) {
      await this.prisma.cursorSellPurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'DONE',
          kind,
          responseEnc: encryptString(JSON.stringify(data)),
          errorCode: 'UNPARSED_RESPONSE',
          failReason: '上游已成交但响应里没有可识别的账号 / 提取卡字段，请查看原始响应后手动发货',
        },
      });
      await this.notify(
        `## 🚨 Team 渠道响应无法解析\n> 采购单 #${purchase.id}${ctx.orderNo ? ` / 订单 ${ctx.orderNo}` : ''}\n\n上游返回 kind=${kind}，但找不到账号/提取卡字段。请到后台采购单详情查看原始响应并手动发货。`,
      );
      return;
    }

    const existing = await this.prisma.cursorSellSale.findMany({ where: { purchaseId: purchase.id } });
    const existingSaleIds = new Set(existing.map((s) => s.saleId).filter((v): v is number => v != null));
    const existingCardIds = new Set(existing.map((s) => s.extractCardId).filter((v): v is number => v != null));

    let anyMaking = false;
    await this.prisma.$transaction(async (tx) => {
      for (const acc of accounts) {
        if (typeof acc.saleId === 'number' && existingSaleIds.has(acc.saleId)) continue;
        const saleKind = classifySale(acc);
        const making = !!acc.making;
        if (making) anyMaking = true;
        const credentials = pickCredentials(acc);
        const content = making ? `账号开通中（渠道单 #${acc.saleId}），请稍后刷新` : buildCardContent(saleKind, acc);

        let cardKeyId: number | null = null;
        if (ctx.order) {
          const ck = await tx.cardKey.create({
            data: {
              productId: ctx.order.productId,
              skuId: ctx.order.skuId,
              content,
              status: 'SOLD',
              soldAt: new Date(),
              orderNo: ctx.order.orderNo,
              remark: `[cursor-sell] saleId=${acc.saleId} kind=${saleKind}${making ? ' making' : ''}`,
            },
          });
          cardKeyId = ck.id;
        }
        await tx.cursorSellSale.create({
          data: {
            purchaseId: purchase.id,
            orderNo: ctx.orderNo,
            cardKeyId,
            saleId: typeof acc.saleId === 'number' ? acc.saleId : null,
            kind: saleKind,
            productCode: acc.productCode || purchase.productCode,
            tier: acc.tier ? String(acc.tier).slice(0, 32) : null,
            email: credentials.email ? credentials.email.slice(0, 255) : null,
            making,
            loginApprove: !!acc.loginApprove,
            warrantyUntil: acc.warrantyUntil ? new Date(acc.warrantyUntil) : null,
            soldAt: acc.soldAt ? new Date(acc.soldAt) : new Date(),
            credentialsEnc: Object.keys(credentials).length ? encryptString(JSON.stringify(credentials)) : null,
          },
        });
      }

      for (const card of extractCards) {
        if (typeof card.id === 'number' && existingCardIds.has(card.id)) continue;
        const content = `${card.code}  # 提取卡密 · 可用 ${card.remainingCredits}/${card.totalCredits} 次`;
        let cardKeyId: number | null = null;
        if (ctx.order) {
          const ck = await tx.cardKey.create({
            data: {
              productId: ctx.order.productId,
              skuId: ctx.order.skuId,
              content,
              status: 'SOLD',
              soldAt: new Date(),
              orderNo: ctx.order.orderNo,
              remark: `[cursor-sell] extractCardId=${card.id} kind=extract`,
            },
          });
          cardKeyId = ck.id;
        }
        await tx.cursorSellSale.create({
          data: {
            purchaseId: purchase.id,
            orderNo: ctx.orderNo,
            cardKeyId,
            extractCardId: typeof card.id === 'number' ? card.id : null,
            kind: 'extract',
            productCode: purchase.productCode,
            soldAt: new Date(),
            credentialsEnc: encryptString(
              JSON.stringify({
                extractCode: card.code,
                masked: card.masked,
                totalCredits: String(card.totalCredits),
                remainingCredits: String(card.remainingCredits),
              }),
            ),
          },
        });
      }

      const boughtCount = accounts.length + extractCards.length;
      await tx.cursorSellPurchase.update({
        where: { id: purchase.id },
        data: {
          status: anyMaking ? 'MAKING' : 'DONE',
          kind,
          responseEnc: encryptString(JSON.stringify(data)),
          costCents: purchase.costCents != null && purchase.qty > 0
            ? Math.round((purchase.costCents / purchase.qty) * boughtCount)
            : purchase.costCents,
          errorCode: null,
          failReason: null,
        },
      });
    });

    if (ctx.orderNo) await this.finalizeOrderIfReady(ctx.orderNo);
  }

  /** 卡密配齐且没有开通中的账号 → 订单 DELIVERED + 销量 + 积分结算 */
  private async finalizeOrderIfReady(orderNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: { cardKeys: { select: { id: true } } },
    });
    if (!order || order.status !== 'PAID') return;
    if (order.cardKeys.length < order.quantity) return;
    const making = await this.prisma.cursorSellSale.count({
      where: { cardKeyId: { in: order.cardKeys.map((c) => c.id) }, making: true },
    });
    if (making > 0) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { orderNo }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      await tx.sku.update({ where: { id: order.skuId }, data: { sales: { increment: order.quantity } } });
      await tx.product.update({ where: { id: order.productId }, data: { sales: { increment: order.quantity } } });
      await this.points.settleDeliveredLocalOrder(tx, orderNo);
    });
    this.logger.log(`order ${orderNo} delivered via cursor-sell`);
  }

  // ─────────────────────────── 现做 Team 轮询 / 凭据回填 ───────────────────────────

  /** cron：轮询开通中的账号；就绪后回填凭据、推进采购单和订单 */
  async pollMaking(limit = 20): Promise<{ checked: number; ready: number }> {
    const sales = await this.prisma.cursorSellSale.findMany({
      where: { making: true, saleId: { not: null } },
      orderBy: { id: 'asc' },
      take: limit,
    });
    let ready = 0;
    for (const sale of sales) {
      try {
        const r = await this.refreshSaleFromUpstream(sale);
        if (r && !r.making) ready++;
      } catch (e) {
        this.logger.warn(`poll making sale #${sale.id} (upstream ${sale.saleId}): ${(e as Error).message}`);
      }
    }
    return { checked: sales.length, ready };
  }

  async refreshSaleById(saleLocalId: number): Promise<SaleView> {
    const sale = await this.mustSale(saleLocalId);
    return this.saleView(await this.refreshSaleFromUpstream(sale));
  }

  /** 重取单个成交单凭据（GET /orders/:saleId），回填 sale / card_key，并按需推进采购单与订单 */
  async refreshSaleFromUpstream(sale: CursorSellSale) {
    if (sale.saleId == null) throw new BadRequestException('该记录没有上游成交单号');
    const data = await this.api.getOrder(sale.saleId);
    const making = !!data.making;
    const saleKind = classifySale({ ...data, loginApprove: data.loginApprove ?? sale.loginApprove });
    const credentials = pickCredentials(data);
    const hasCreds = Object.keys(credentials).length > 0;
    const content = making
      ? `账号开通中（渠道单 #${sale.saleId}），请稍后刷新`
      : buildCardContent(saleKind, data as UpstreamAccountSale);

    const updated = await this.prisma.$transaction(async (tx) => {
      const s = await tx.cursorSellSale.update({
        where: { id: sale.id },
        data: {
          making,
          kind: making ? sale.kind : saleKind,
          tier: data.tier ? String(data.tier).slice(0, 32) : sale.tier,
          email: credentials.email ? credentials.email.slice(0, 255) : sale.email,
          loginApprove: data.loginApprove ?? sale.loginApprove,
          warrantyUntil: data.warrantyUntil ? new Date(data.warrantyUntil) : sale.warrantyUntil,
          soldAt: data.soldAt ? new Date(data.soldAt) : sale.soldAt,
          credentialsEnc: hasCreds ? encryptString(JSON.stringify(credentials)) : sale.credentialsEnc,
        },
      });
      if (sale.cardKeyId && (!making || sale.making)) {
        await tx.cardKey.update({
          where: { id: sale.cardKeyId },
          data: {
            content,
            remark: `[cursor-sell] saleId=${sale.saleId} kind=${saleKind}${making ? ' making' : ''}`,
          },
        });
      }
      return s;
    });

    if (!making) {
      const stillMaking = await this.prisma.cursorSellSale.count({
        where: { purchaseId: sale.purchaseId, making: true },
      });
      if (stillMaking === 0) {
        await this.prisma.cursorSellPurchase.updateMany({
          where: { id: sale.purchaseId, status: 'MAKING' },
          data: { status: 'DONE' },
        });
      }
      const orderNo = sale.orderNo || (sale.cardKeyId
        ? (await this.prisma.cardKey.findUnique({ where: { id: sale.cardKeyId }, select: { orderNo: true } }))?.orderNo
        : null);
      if (orderNo) await this.finalizeOrderIfReady(orderNo);
    }
    return updated;
  }

  // ─────────────────────────── 手动采购结果推送到库存 ───────────────────────────

  /** 把某采购单下所有未入库、非开通中的成交推到卡密池 / 仓库 */
  async pushPurchase(purchaseId: number, destination: PushDestination, skuId: number | null) {
    const sales = await this.prisma.cursorSellSale.findMany({
      where: { purchaseId, cardKeyId: null, making: false },
    });
    let pushed = 0;
    for (const s of sales) {
      await this.pushSale(s.id, destination, skuId);
      pushed++;
    }
    return { pushed };
  }

  async pushSale(saleLocalId: number, destination: PushDestination, skuId: number | null) {
    if (destination === 'NONE') return { ok: true };
    const sale = await this.prisma.cursorSellSale.findUnique({ where: { id: saleLocalId } });
    if (!sale) throw new NotFoundException('成交记录不存在');
    if (sale.making) throw new BadRequestException('账号仍在开通中，暂不能入库');
    if (sale.cardKeyId) throw new BadRequestException('该成交已入卡密池');
    const creds = this.decryptCredentials(sale.credentialsEnc);
    const content = this.contentFromSale(sale, creds);
    if (!content) throw new BadRequestException('没有可入库的凭据内容');

    if (destination === 'CARD_POOL') {
      if (!skuId) throw new BadRequestException('入卡密池需要选择本站规格');
      const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
      if (!sku) throw new NotFoundException('本站规格不存在');
      const ck = await this.prisma.cardKey.create({
        data: {
          productId: sku.productId,
          skuId: sku.id,
          content,
          status: 'AVAILABLE',
          remark: `[cursor-sell] saleId=${sale.saleId ?? '-'} kind=${sale.kind} 手动采购入库`,
          expireAt: sale.warrantyUntil,
        },
      });
      await this.prisma.cursorSellSale.update({ where: { id: sale.id }, data: { cardKeyId: ck.id } });
      return { ok: true, cardKeyId: ck.id };
    }

    // WAREHOUSE：sourceRef 去重，仓库里再由管理员分配到商品
    const ref = `cursor-sell:${sale.saleId ?? `x${sale.extractCardId ?? sale.id}`}`;
    const r = await this.warehouse.bulkImport([
      {
        sourceRef: ref,
        content,
        email: creds.email || sale.email || undefined,
        remark: `Team 渠道 ${sale.productCode} · ${sale.tier || ''}`.trim(),
      },
    ]);
    return { ok: true, warehouse: r };
  }

  // ─────────────────────────── 授权登录 / 额度 / 教程 ───────────────────────────

  async loginApprove(saleLocalId: number, loginUrl: string) {
    const sale = await this.mustSale(saleLocalId);
    if (sale.saleId == null) throw new BadRequestException('该成交没有上游单号');
    if (sale.making) throw new BadRequestException('账号仍在开通中，请稍后再试');
    const url = (loginUrl || '').trim();
    if (!/^https:\/\/(www\.)?cursor\.com\/loginDeepControl\?/i.test(url)) {
      throw new BadRequestException('请粘贴 Cursor 客户端登录时浏览器地址栏里完整的 loginDeepControl 链接');
    }
    const r = await this.api.loginApprove(sale.saleId, url);
    if (r?.approved) {
      await this.prisma.cursorSellSale.update({
        where: { id: sale.id },
        data: { loginApprovedAt: new Date() },
      });
    }
    return { approved: !!r?.approved };
  }

  async usage(saleLocalId: number) {
    const sale = await this.mustSale(saleLocalId);
    if (sale.saleId == null) throw new BadRequestException('该成交没有上游单号');
    const usage = await this.api.getUsage(sale.saleId);
    await this.prisma.cursorSellSale.update({
      where: { id: sale.id },
      data: { usageJson: usage as Prisma.InputJsonValue, usageAt: new Date() },
    });
    return usage;
  }

  async loginTutorial(saleLocalId: number) {
    const sale = await this.mustSale(saleLocalId);
    if (sale.saleId == null) throw new BadRequestException('该成交没有上游单号');
    return this.api.getLoginTutorial(sale.saleId);
  }

  // ─────────────────────────── 查询 / 视图 ───────────────────────────

  async listPurchases(q: {
    page?: number;
    pageSize?: number;
    status?: string;
    source?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, q.page || 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize || 50));
    const where: Prisma.CursorSellPurchaseWhereInput = {};
    if (q.status) where.status = q.status as CursorSellPurchase['status'];
    if (q.source) where.source = q.source as CursorSellPurchase['source'];
    if (q.keyword) {
      where.OR = [
        { orderNo: { contains: q.keyword } },
        { productCode: { contains: q.keyword } },
        { productTitle: { contains: q.keyword } },
        { idempotencyKey: { contains: q.keyword } },
        { sales: { some: { email: { contains: q.keyword } } } },
      ];
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.cursorSellPurchase.count({ where }),
      this.prisma.cursorSellPurchase.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { sales: true } } },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((p) => this.purchaseView(p, p._count.sales)),
    };
  }

  async getPurchase(id: number) {
    const p = await this.prisma.cursorSellPurchase.findUnique({
      where: { id },
      include: { sales: { orderBy: { id: 'asc' } } },
    });
    if (!p) throw new NotFoundException('采购单不存在');
    let rawResponse: unknown = null;
    if (p.responseEnc) {
      try {
        rawResponse = JSON.parse(decryptString(p.responseEnc));
      } catch {
        rawResponse = null;
      }
    }
    return {
      ...this.purchaseView(p, p.sales.length),
      sales: p.sales.map((s) => this.saleView(s)),
      rawResponse,
    };
  }

  /** 订单详情用：按卡密 id 找出 Team 成交信息（含解密凭据） */
  async salesForCardKeys(cardKeyIds: number[]): Promise<SaleView[]> {
    if (!cardKeyIds.length) return [];
    const rows = await this.prisma.cursorSellSale.findMany({
      where: { cardKeyId: { in: cardKeyIds } },
      orderBy: { id: 'asc' },
    });
    return rows.map((s) => this.saleView(s));
  }

  async getSale(id: number): Promise<SaleView> {
    return this.saleView(await this.mustSale(id));
  }

  async stats() {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const [pending, making, failed, todayDone, todayCost, productCount, activeProductCount] = await Promise.all([
      this.prisma.cursorSellPurchase.count({ where: { status: 'PENDING' } }),
      this.prisma.cursorSellPurchase.count({ where: { status: 'MAKING' } }),
      this.prisma.cursorSellPurchase.count({ where: { status: 'FAILED' } }),
      this.prisma.cursorSellPurchase.count({ where: { status: { in: ['DONE', 'MAKING'] }, createdAt: { gte: dayStart } } }),
      this.prisma.cursorSellPurchase.aggregate({
        where: { status: { in: ['DONE', 'MAKING'] }, createdAt: { gte: dayStart } },
        _sum: { costCents: true },
      }),
      this.prisma.cursorSellProduct.count(),
      this.prisma.cursorSellProduct.count({ where: { active: true } }),
    ]);
    return {
      pending,
      making,
      failed,
      todayPurchases: todayDone,
      todayCostCents: todayCost._sum.costCents ?? 0,
      productCount,
      activeProductCount,
      lastSyncAt: await this.catalog.lastSyncAt(),
    };
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async mustSale(id: number) {
    const sale = await this.prisma.cursorSellSale.findUnique({ where: { id } });
    if (!sale) throw new NotFoundException('成交记录不存在');
    return sale;
  }

  decryptCredentials(enc: string | null): Record<string, string> {
    if (!enc) return {};
    try {
      const obj = JSON.parse(decryptString(enc));
      return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private contentFromSale(sale: CursorSellSale, creds: Record<string, string>): string {
    if (sale.kind === 'extract') return creds.extractCode || '';
    if (sale.kind === 'card') return creds.cardNote ? `${creds.card}  # ${creds.cardNote}` : creds.card || '';
    if (sale.kind === 'login') return creds.email || sale.email || '';
    if (creds.rawLine) return creds.rawLine;
    return [creds.email, creds.password, creds.token].filter(Boolean).join('----');
  }

  private purchaseView(p: CursorSellPurchase, saleCount: number) {
    return {
      id: p.id,
      idempotencyKey: p.idempotencyKey,
      source: p.source,
      orderNo: p.orderNo,
      productCode: p.productCode,
      productTitle: p.productTitle,
      qty: p.qty,
      extractSplit: p.extractSplit,
      status: p.status,
      kind: p.kind,
      costCents: p.costCents,
      cost: p.costCents == null ? null : p.costCents / 100,
      errorCode: p.errorCode,
      failReason: p.failReason,
      attempts: p.attempts,
      lastAttemptAt: p.lastAttemptAt,
      operatorId: p.operatorId,
      saleCount,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  saleView(s: CursorSellSale): SaleView {
    return {
      id: s.id,
      purchaseId: s.purchaseId,
      orderNo: s.orderNo,
      cardKeyId: s.cardKeyId,
      saleId: s.saleId,
      extractCardId: s.extractCardId,
      kind: s.kind,
      productCode: s.productCode,
      tier: s.tier,
      email: s.email,
      making: s.making,
      loginApprove: s.loginApprove,
      loginApprovedAt: s.loginApprovedAt,
      warrantyUntil: s.warrantyUntil,
      soldAt: s.soldAt,
      credentials: this.decryptCredentials(s.credentialsEnc),
      usage: s.usageJson,
      usageAt: s.usageAt,
      createdAt: s.createdAt,
    };
  }

  /** 后台列表里的脱敏凭据（不下发 token 明文） */
  static maskCredentials(creds: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(creds)) {
      out[k] = k === 'token' || k === 'password' ? maskSecret(v, 8, 4) : v;
    }
    return out;
  }

  private async notify(markdown: string) {
    try {
      await this.wecom.sendMarkdown(markdown);
    } catch (e) {
      this.logger.warn(`wecom notify failed: ${(e as Error).message}`);
    }
  }
}
