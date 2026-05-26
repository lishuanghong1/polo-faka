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
import { Prisma, ForgeOrderStatus, ForgeRedeemStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ForgeApiError,
  ForgeOpenapiService,
} from '../forge-openapi/forge-openapi.service';
import { encryptString, decryptString, isEncrypted } from '../../common/crypto.util';
import {
  GenerateForgeCodesDto,
  UpdateForgeProductDto,
} from './dto';

const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const codeNano = customAlphabet(codeAlphabet, 16);
const orderNano = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

function makeRedeemCode(prefix = 'FK'): string {
  // FK-XXXX-XXXX-XXXX-XXXX
  const raw = codeNano();
  return `${prefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function makeOrderNo(): string {
  return `F${dayjs().format('YYYYMMDDHHmmss')}${orderNano()}`;
}

/**
 * customer_ref：用 sha256(code + salt) 做脱敏标识。
 * 我方不保存终端用户真实信息（兑换码场景下也根本没有），
 * 用兑换码本身做 ref 也方便对账。
 */
function makeCustomerRef(code: string): string {
  const salt = process.env.POOL_ENCRYPTION_KEY || process.env.JWT_SECRET || 'polo_faka';
  return createHash('sha256').update(`${code}::${salt}`).digest('hex').slice(0, 32);
}

@Injectable()
export class ForgeRedeemService {
  private readonly logger = new Logger(ForgeRedeemService.name);

  constructor(
    private prisma: PrismaService,
    private forge: ForgeOpenapiService,
  ) {}

  // ─────────────────────────── 商品同步 / 管理 ───────────────────────────

  /** 从三方拉取商品列表，merge 到本地 forge_products */
  async syncProducts() {
    const r = await this.forge.request<{
      categories: Array<{
        category_key: string;
        category_name: string;
        types: Array<{
          type_key: string;
          type_name: string;
          price: number;
          vip_price?: number;
          agent_price: number;
          stock: number;
          warranty_hours?: number;
          email_code_enabled?: boolean;
        }>;
      }>;
      currency: string;
    }>('GET', '/openapi/v1/products');

    const cats = r.data?.categories || [];
    let upserted = 0;
    const seenKeys: string[] = [];
    for (const cat of cats) {
      for (const t of cat.types || []) {
        seenKeys.push(t.type_key);
        const agentPrice = Number(t.agent_price ?? 0);
        await this.prisma.forgeProduct.upsert({
          where: { typeKey: t.type_key },
          create: {
            typeKey: t.type_key,
            categoryKey: cat.category_key,
            typeName: t.type_name,
            categoryName: cat.category_name,
            price: new Prisma.Decimal(t.price ?? 0),
            agentPrice: new Prisma.Decimal(agentPrice),
            stock: Number.isInteger(t.stock) ? t.stock : 0,
            warrantyHours: t.warranty_hours ?? null,
            emailCodeEnabled: !!t.email_code_enabled,
            // 首次同步默认售价 = 代理价（管理员手动改）
            displayPrice: new Prisma.Decimal(agentPrice),
            enabled: false,
            lastSyncAt: new Date(),
          },
          update: {
            categoryKey: cat.category_key,
            typeName: t.type_name,
            categoryName: cat.category_name,
            price: new Prisma.Decimal(t.price ?? 0),
            agentPrice: new Prisma.Decimal(agentPrice),
            stock: Number.isInteger(t.stock) ? t.stock : 0,
            warrantyHours: t.warranty_hours ?? null,
            emailCodeEnabled: !!t.email_code_enabled,
            lastSyncAt: new Date(),
          },
        });
        upserted += 1;
      }
    }
    return { upserted, seenKeys, syncedAt: new Date() };
  }

  async listProductsAdmin() {
    return this.prisma.forgeProduct.findMany({
      orderBy: [{ enabled: 'desc' }, { sort: 'asc' }, { typeKey: 'asc' }],
    });
  }

  /** 前台展示：仅 enabled 商品，且按 sort 排序，并暴露最少字段 */
  async listProductsPublic() {
    const rows = await this.prisma.forgeProduct.findMany({
      where: { enabled: true },
      orderBy: [{ sort: 'asc' }, { displayPrice: 'asc' }],
    });
    return rows.map((r) => ({
      typeKey: r.typeKey,
      categoryKey: r.categoryKey,
      categoryName: r.categoryName,
      typeName: r.typeName,
      displayPrice: Number(r.displayPrice),
      stock: r.stock,
      warrantyHours: r.warrantyHours,
      emailCodeEnabled: r.emailCodeEnabled,
    }));
  }

  async updateProduct(typeKey: string, dto: UpdateForgeProductDto) {
    const exists = await this.prisma.forgeProduct.findUnique({ where: { typeKey } });
    if (!exists) throw new NotFoundException('商品不存在');
    return this.prisma.forgeProduct.update({
      where: { typeKey },
      data: {
        ...(dto.displayPrice !== undefined && {
          displayPrice: new Prisma.Decimal(dto.displayPrice),
        }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.sort !== undefined && { sort: dto.sort }),
      },
    });
  }

  // ─────────────────────────── 兑换码 CRUD ───────────────────────────

  async generateCodes(dto: GenerateForgeCodesDto) {
    const batchTag = `FB${dayjs().format('YYYYMMDDHHmmss')}-${codeNano().slice(0, 6)}`;
    const expireAt = dto.expireAt ? new Date(dto.expireAt) : null;
    const codes: string[] = [];
    while (codes.length < dto.count) {
      const need = dto.count - codes.length;
      const candidates = Array.from({ length: need }, () => makeRedeemCode(dto.prefix || 'FK'));
      await this.prisma.forgeRedeemCode.createMany({
        data: candidates.map((code) => ({
          code,
          totalAmount: new Prisma.Decimal(dto.totalAmount),
          expireAt,
          batchTag,
          note: dto.note,
        })),
        skipDuplicates: true,
      });
      const written = await this.prisma.forgeRedeemCode.findMany({
        where: { batchTag, code: { in: candidates } },
        select: { code: true },
      });
      codes.push(...written.map((w) => w.code));
    }
    return { batchTag, count: codes.length, codes };
  }

  async listCodes(query: {
    page?: number;
    pageSize?: number;
    status?: string;
    batchTag?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const where: Prisma.ForgeRedeemCodeWhereInput = {};
    if (query.status) where.status = query.status as ForgeRedeemStatus;
    if (query.batchTag) where.batchTag = query.batchTag;
    if (query.keyword) where.code = { contains: query.keyword };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.forgeRedeemCode.count({ where }),
      this.prisma.forgeRedeemCode.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async batches(limit = 50) {
    const rows = await this.prisma.forgeRedeemCode.groupBy({
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
    const items = await this.prisma.forgeRedeemCode.findMany({
      where: { batchTag },
      orderBy: { id: 'asc' },
      select: { code: true, status: true, totalAmount: true, usedAmount: true },
    });
    return { batchTag, count: items.length, items };
  }

  async toggleCodeStatus(id: number, status: 'ACTIVE' | 'DISABLED') {
    if (!['ACTIVE', 'DISABLED'].includes(status)) {
      throw new BadRequestException('状态不合法');
    }
    return this.prisma.forgeRedeemCode.update({
      where: { id },
      data: { status: status as ForgeRedeemStatus },
    });
  }

  async removeCode(id: number) {
    const r = await this.prisma.forgeRedeemCode.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('兑换码不存在');
    if (Number(r.usedAmount) > 0) {
      throw new BadRequestException('已使用过的码不能删除，请改为禁用');
    }
    await this.prisma.forgeRedeemCode.delete({ where: { id } });
    return { ok: true };
  }

  // ─────────────────────────── 客户兑换 ───────────────────────────

  /** 查询单个码（不消耗），返回余额 + 已兑过的订单列表 + 可下单商品列表 */
  async checkCode(rawCode: string) {
    const code = await this.prisma.forgeRedeemCode.findUnique({
      where: { code: (rawCode || '').trim() },
      include: {
        orders: {
          orderBy: { id: 'desc' },
          take: 50,
          select: {
            orderNo: true,
            typeName: true,
            typeKey: true,
            quantity: true,
            totalAmount: true,
            status: true,
            createdAt: true,
            deliveredAt: true,
          },
        },
      },
    });
    if (!code) throw new NotFoundException('兑换码不存在');

    // 自动失效
    if (
      code.status === 'ACTIVE' &&
      code.expireAt &&
      code.expireAt.getTime() < Date.now()
    ) {
      await this.prisma.forgeRedeemCode.update({
        where: { id: code.id },
        data: { status: 'EXPIRED' },
      });
      code.status = 'EXPIRED';
    }

    const remaining = Math.max(0, Number(code.totalAmount) - Number(code.usedAmount));
    const products = await this.listProductsPublic();

    return {
      code: code.code,
      status: code.status,
      totalAmount: Number(code.totalAmount),
      usedAmount: Number(code.usedAmount),
      remaining,
      expireAt: code.expireAt,
      note: code.note,
      orders: code.orders,
      products,
    };
  }

  /**
   * 核心下单。
   * 流程：
   *   1. 行锁：拿兑换码 + 校验
   *   2. 检查余额 ≥ 售价×数量
   *   3. 预扣 usedAmount + 创建 PENDING ForgeOrder（事务内）
   *   4. 事务外：调三方 HMAC 下单
   *   5. 成功：写 upstreamData（加密）+ DELIVERED；失败：回滚 usedAmount + FAILED
   */
  async createOrder(input: {
    code: string;
    typeKey: string;
    quantity: number;
    ip?: string;
  }) {
    const rawCode = (input.code || '').trim();
    if (!rawCode) throw new BadRequestException('请填写兑换码');
    if (!input.typeKey) throw new BadRequestException('请选择商品');
    if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 10) {
      throw new BadRequestException('数量必须为 1-10');
    }

    const product = await this.prisma.forgeProduct.findUnique({
      where: { typeKey: input.typeKey },
    });
    if (!product || !product.enabled) {
      throw new NotFoundException('该商品不存在或未上架');
    }
    const displayPrice = Number(product.displayPrice);
    const totalAmount = +(displayPrice * input.quantity).toFixed(2);

    // ─── Phase 1：事务内预扣 + 创建 PENDING 订单 ───
    const { orderNo, codeRow } = await this.prisma.$transaction(async (tx) => {
      const code = await tx.forgeRedeemCode.findUnique({ where: { code: rawCode } });
      if (!code) throw new NotFoundException('兑换码不存在');
      if (code.status === 'DISABLED') {
        throw new BadRequestException('该兑换码已被禁用');
      }
      if (code.status === 'EXHAUSTED') {
        throw new BadRequestException('该兑换码余额已用完');
      }
      if (
        code.expireAt &&
        code.expireAt.getTime() < Date.now()
      ) {
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

      // 乐观锁预扣 usedAmount
      const newUsed = +(Number(code.usedAmount) + totalAmount).toFixed(2);
      const nextStatus: ForgeRedeemStatus =
        newUsed >= Number(code.totalAmount) - 0.001 ? 'EXHAUSTED' : 'ACTIVE';
      const updated = await tx.forgeRedeemCode.updateMany({
        where: {
          id: code.id,
          usedAmount: code.usedAmount,
          status: { in: ['ACTIVE'] },
        },
        data: {
          usedAmount: new Prisma.Decimal(newUsed),
          status: nextStatus,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('兑换繁忙，请重试');
      }

      const orderNo = makeOrderNo();
      await tx.forgeOrder.create({
        data: {
          orderNo,
          redeemCodeId: code.id,
          typeKey: product.typeKey,
          typeName: product.typeName,
          quantity: input.quantity,
          displayPrice: new Prisma.Decimal(displayPrice),
          totalAmount: new Prisma.Decimal(totalAmount),
          customerRef: makeCustomerRef(code.code),
          status: 'PENDING',
          ip: input.ip,
        },
      });
      return { orderNo, codeRow: code };
    });

    // ─── Phase 2：事务外调三方下单 ───
    try {
      const r = await this.forge.request<any>('POST', '/openapi/v1/orders', {
        type_key: input.typeKey,
        quantity: input.quantity,
        external_order_id: orderNo,
        customer_ref: makeCustomerRef(codeRow.code),
      });
      const upstream = r.data || {};

      // 加密保存 accounts（含 access_token）
      const encrypted = encryptString(JSON.stringify(upstream.accounts || []));

      await this.prisma.forgeOrder.update({
        where: { orderNo },
        data: {
          status: 'DELIVERED',
          upstreamOrderNo: upstream.order_no,
          upstreamRequestId: r.requestId,
          upstreamAmount:
            upstream.amount !== undefined
              ? new Prisma.Decimal(upstream.amount)
              : null,
          upstreamData: encrypted,
          deliveredAt: new Date(),
        },
      });

      return this.detail(orderNo);
    } catch (e) {
      const failCode = e instanceof ForgeApiError ? e.code : 'NETWORK_ERROR';
      const failMsg =
        e instanceof ForgeApiError
          ? ForgeOpenapiService.friendlyMessage(e.code, e.upstreamMessage)
          : (e as Error)?.message || '上游服务暂时不可用';

      // 回滚 usedAmount + 标记 FAILED
      await this.prisma.$transaction([
        this.prisma.forgeRedeemCode.update({
          where: { id: codeRow.id },
          data: {
            usedAmount: { decrement: new Prisma.Decimal(totalAmount) },
            // 如果之前因为这次预扣变成 EXHAUSTED，要回退到 ACTIVE
            status: 'ACTIVE',
          },
        }),
        this.prisma.forgeOrder.update({
          where: { orderNo },
          data: {
            status: 'FAILED',
            failReason: `${failCode}: ${failMsg}`.slice(0, 500),
          },
        }),
      ]);

      throw ForgeOpenapiService.toHttpException(e);
    }
  }

  /** 订单详情（解密 accounts） */
  async detail(orderNo: string) {
    const order = await this.prisma.forgeOrder.findUnique({
      where: { orderNo },
    });
    if (!order) throw new NotFoundException('订单不存在');

    let accounts: any[] = [];
    if (order.upstreamData) {
      try {
        const raw = isEncrypted(order.upstreamData)
          ? decryptString(order.upstreamData)
          : order.upstreamData;
        accounts = JSON.parse(raw) || [];
      } catch (e) {
        this.logger.error(`decrypt forge_order ${orderNo} accounts failed: ${(e as Error).message}`);
      }
    }

    return {
      orderNo: order.orderNo,
      typeKey: order.typeKey,
      typeName: order.typeName,
      quantity: order.quantity,
      displayPrice: Number(order.displayPrice),
      totalAmount: Number(order.totalAmount),
      status: order.status,
      upstreamOrderNo: order.upstreamOrderNo,
      deliveredAt: order.deliveredAt,
      failReason: order.failReason,
      createdAt: order.createdAt,
      accounts,
    };
  }

  // ─────────────────────────── Admin: 订单流水 ───────────────────────────

  async listOrdersAdmin(query: {
    page?: number;
    pageSize?: number;
    status?: ForgeOrderStatus;
    typeKey?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const where: Prisma.ForgeOrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.typeKey) where.typeKey = query.typeKey;
    if (query.keyword) {
      where.OR = [
        { orderNo: { contains: query.keyword } },
        { upstreamOrderNo: { contains: query.keyword } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.forgeOrder.count({ where }),
      this.prisma.forgeOrder.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          redeemCode: { select: { code: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((it) => ({
        orderNo: it.orderNo,
        redeemCode: it.redeemCode?.code,
        typeKey: it.typeKey,
        typeName: it.typeName,
        quantity: it.quantity,
        displayPrice: Number(it.displayPrice),
        totalAmount: Number(it.totalAmount),
        status: it.status,
        upstreamOrderNo: it.upstreamOrderNo,
        upstreamAmount: it.upstreamAmount !== null ? Number(it.upstreamAmount) : null,
        failReason: it.failReason,
        deliveredAt: it.deliveredAt,
        createdAt: it.createdAt,
      })),
    };
  }

  /** Admin 详情：含 accounts 用于排查 */
  async detailAdmin(orderNo: string) {
    return this.detail(orderNo);
  }
}
