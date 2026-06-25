import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, ProductSource, VipTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

/** 等级顺序（NONE < GOLD < DIAMOND < SUPREME），数字越大越高 */
const TIER_RANK: Record<VipTier, number> = {
  NONE: 0,
  GOLD: 1,
  DIAMOND: 2,
  SUPREME: 3,
};

/** 默认等级配置（首次启动时自动 seed） */
const DEFAULT_CONFIGS: {
  tier: Exclude<VipTier, 'NONE'>;
  name: string;
  threshold: number;
  defaultDiscount: number;
  color: string;
  icon: string;
  sort: number;
  benefits: string[];
}[] = [
  {
    tier: 'GOLD',
    name: '黄金会员',
    threshold: 100,
    defaultDiscount: 0.95,
    color: '#d4a017',
    icon: '🥇',
    sort: 1,
    benefits: ['全场 95 折', '优先客服响应'],
  },
  {
    tier: 'DIAMOND',
    name: '钻石会员',
    threshold: 500,
    defaultDiscount: 0.9,
    color: '#0ea5e9',
    icon: '💎',
    sort: 2,
    benefits: ['全场 9 折', '专属客服通道', '充值赠送活动优先'],
  },
  {
    tier: 'SUPREME',
    name: '超级无敌会员',
    threshold: 2000,
    defaultDiscount: 0.85,
    color: '#a855f7',
    icon: '👑',
    sort: 3,
    benefits: ['全场 85 折', '一对一专属管家', '所有新品抢先体验'],
  },
];

/** 折扣安全下限：低于此值视为配置异常，按下限兜底（防呆） */
const DISCOUNT_FLOOR = 0.5;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class VipService implements OnModuleInit {
  private readonly logger = new Logger(VipService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** 启动时确保 3 条默认配置存在（不覆盖管理员已有改动） */
  async onModuleInit() {
    for (const cfg of DEFAULT_CONFIGS) {
      const exist = await this.prisma.vipConfig.findUnique({ where: { tier: cfg.tier } });
      if (!exist) {
        await this.prisma.vipConfig.create({
          data: {
            tier: cfg.tier,
            name: cfg.name,
            threshold: new Prisma.Decimal(cfg.threshold),
            defaultDiscount: new Prisma.Decimal(cfg.defaultDiscount),
            color: cfg.color,
            icon: cfg.icon,
            sort: cfg.sort,
            benefits: cfg.benefits,
          },
        });
        this.logger.log(`seeded VIP config: ${cfg.tier}`);
      }
    }
  }

  /** 列出所有等级配置（含隐含 NONE，用于前端展示） */
  async listConfigs() {
    const items = await this.prisma.vipConfig.findMany({ orderBy: { sort: 'asc' } });
    return items.map((c) => ({
      tier: c.tier,
      name: c.name,
      threshold: Number(c.threshold),
      defaultDiscount: Number(c.defaultDiscount),
      color: c.color,
      icon: c.icon,
      benefits: (c.benefits as string[] | null) ?? [],
      sort: c.sort,
    }));
  }

  /** 给定累计充值额，计算应处等级（不更新数据库） */
  async computeTier(totalRecharged: number): Promise<VipTier> {
    const items = await this.prisma.vipConfig.findMany({
      orderBy: { threshold: 'desc' },
    });
    for (const c of items) {
      if (totalRecharged >= Number(c.threshold)) {
        return c.tier;
      }
    }
    return VipTier.NONE;
  }

  /**
   * 充值入账后调用：累加 totalRecharged 并按需升级（永远不降）。
   * 必须传 Prisma 事务客户端，确保与 recharge 入账在同一事务。
   */
  async accrueRechargeAndUpgrade(
    tx: Prisma.TransactionClient,
    userId: number,
    amount: number,
  ) {
    const u = await tx.user.update({
      where: { id: userId },
      data: { totalRecharged: { increment: new Prisma.Decimal(amount) } },
      select: { id: true, totalRecharged: true, vipTier: true },
    });
    const targetTier = await this.computeTier(Number(u.totalRecharged));
    // 永久不回落：只在新等级 > 当前等级时升级
    if (TIER_RANK[targetTier] > TIER_RANK[u.vipTier]) {
      await tx.user.update({
        where: { id: userId },
        data: { vipTier: targetTier, vipUpgradedAt: new Date() },
      });
      return { upgraded: true, from: u.vipTier, to: targetTier };
    }
    return { upgraded: false, from: u.vipTier, to: u.vipTier };
  }

  /** 升级触发的审计写入（不放事务里，避免 audit 失败回滚业务） */
  async writeUpgradeAudit(userId: number, from: VipTier, to: VipTier) {
    await this.audit.record({
      action: AuditActions.VIP_UPGRADE,
      target: `user:${userId}`,
      actorId: userId,
      actor: `user:${userId}`,
      detail: { from, to },
    });
  }

  /** 管理员手动调级 */
  async manualSet(
    targetUserId: number,
    newTier: VipTier,
    actor: { id: number; username: string },
    note?: string,
  ) {
    const u = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!u) throw new NotFoundException('用户不存在');
    if (u.vipTier === newTier) {
      return { tier: u.vipTier, changed: false };
    }
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { vipTier: newTier, vipUpgradedAt: new Date() },
    });
    await this.audit.record({
      action: AuditActions.VIP_MANUAL_SET,
      target: `user:${targetUserId}`,
      actorId: actor.id,
      actor: actor.username,
      detail: { from: u.vipTier, to: newTier, note },
    });
    return { tier: newTier, changed: true };
  }

  /**
   * 取一个用户对某商品的折扣率（0.5 ~ 1）。
   * 优先级：商品级配置 > 等级默认折扣，得到「VIP 折扣」；
   * 再与用户「专属折扣」取更优（更低乘数 = 更大优惠）的一个。
   * - NONE 用户的 VIP 折扣固定 1，但若有专属折扣仍可享受。
   * - custom=true 表示最终折扣来自专属折扣（而非 VIP 体系）。
   */
  async getDiscount(
    userId: number | null | undefined,
    productSource: ProductSource,
    productKey: string,
  ): Promise<{ tier: VipTier; discount: number; custom: boolean }> {
    if (!userId) return { tier: VipTier.NONE, discount: 1, custom: false };
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { vipTier: true, customDiscount: true },
    });
    if (!u) return { tier: VipTier.NONE, discount: 1, custom: false };

    const customDiscount = u.customDiscount != null ? Number(u.customDiscount) : null;

    // VIP 折扣：NONE 用户为 1；否则商品级覆盖优先，回退到等级默认
    let vipDiscount = 1;
    if (u.vipTier !== VipTier.NONE) {
      const pd = await this.prisma.productDiscount.findUnique({
        where: {
          productSource_productKey_tier: {
            productSource,
            productKey,
            tier: u.vipTier,
          },
        },
      });
      if (pd) {
        vipDiscount = Number(pd.discount);
      } else {
        const cfg = await this.prisma.vipConfig.findUnique({
          where: { tier: u.vipTier },
          select: { defaultDiscount: true },
        });
        vipDiscount = cfg ? Number(cfg.defaultDiscount) : 1;
      }
    }

    // 取更优：专属折扣只在「比 VIP 折扣更低」时生效，确保永远不让用户吃亏
    let discount = vipDiscount;
    let custom = false;
    if (customDiscount != null && customDiscount < discount) {
      discount = customDiscount;
      custom = true;
    }

    // 防呆兜底：低于下限按下限算（极少触发，防止管理员配错）
    if (discount < DISCOUNT_FLOOR) discount = DISCOUNT_FLOOR;
    if (discount > 1) discount = 1;
    return { tier: u.vipTier, discount, custom };
  }

  /** 计算一笔金额的会员价：返回 originalAmount/discountAmount/payAmount/tier/discount/custom */
  async applyDiscount(
    userId: number | null | undefined,
    productSource: ProductSource,
    productKey: string,
    originalAmount: number,
  ) {
    const { tier, discount, custom } = await this.getDiscount(userId, productSource, productKey);
    if (discount >= 1 || originalAmount <= 0) {
      return {
        tier,
        discount,
        custom,
        originalAmount: round2(originalAmount),
        discountAmount: 0,
        payAmount: round2(originalAmount),
      };
    }
    const payAmount = round2(originalAmount * discount);
    const discountAmount = round2(originalAmount - payAmount);
    return {
      tier,
      discount,
      custom,
      originalAmount: round2(originalAmount),
      discountAmount,
      payAmount,
    };
  }

  /** 给商品详情页用：批量返回某商品在所有 3 档下的会员价（无需登录） */
  async listProductDiscounts(productSource: ProductSource, productKey: string) {
    const [configs, overrides] = await this.prisma.$transaction([
      this.prisma.vipConfig.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.productDiscount.findMany({
        where: { productSource, productKey },
      }),
    ]);
    const ovMap = new Map<string, number>();
    for (const o of overrides) ovMap.set(o.tier, Number(o.discount));
    return configs.map((c) => ({
      tier: c.tier,
      name: c.name,
      icon: c.icon,
      color: c.color,
      discount: ovMap.has(c.tier) ? ovMap.get(c.tier)! : Number(c.defaultDiscount),
      isOverride: ovMap.has(c.tier),
    }));
  }

  /** 我的 VIP 状态 + 进度（用户中心展示） */
  async getMyVipInfo(userId: number) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        vipTier: true,
        totalRecharged: true,
        vipUpgradedAt: true,
        customDiscount: true,
      },
    });
    if (!u) throw new NotFoundException('用户不存在');
    const configs = await this.prisma.vipConfig.findMany({
      orderBy: { sort: 'asc' },
    });
    const currentRank = TIER_RANK[u.vipTier];
    const next = configs.find((c) => TIER_RANK[c.tier] > currentRank);
    const totalRecharged = Number(u.totalRecharged);

    const currentCfg = configs.find((c) => c.tier === u.vipTier);
    return {
      tier: u.vipTier,
      tierName: currentCfg?.name ?? '普通用户',
      tierColor: currentCfg?.color ?? null,
      tierIcon: currentCfg?.icon ?? null,
      totalRecharged,
      benefits: (currentCfg?.benefits as string[] | null) ?? [],
      defaultDiscount: currentCfg ? Number(currentCfg.defaultDiscount) : 1,
      customDiscount: u.customDiscount != null ? Number(u.customDiscount) : null,
      upgradedAt: u.vipUpgradedAt,
      next: next
        ? {
            tier: next.tier,
            name: next.name,
            threshold: Number(next.threshold),
            remain: Math.max(0, round2(Number(next.threshold) - totalRecharged)),
            progress: Math.min(
              1,
              Math.max(0, totalRecharged / Number(next.threshold)),
            ),
          }
        : null,
    };
  }

  // ============= 管理员：VIP 等级配置 =============

  async updateConfig(
    tier: Exclude<VipTier, 'NONE'>,
    body: {
      name: string;
      threshold: number;
      defaultDiscount: number;
      color?: string;
      icon?: string;
      benefits?: string[];
    },
    actor: { id: number; username: string },
  ) {
    if (body.defaultDiscount < DISCOUNT_FLOOR || body.defaultDiscount > 1) {
      throw new BadRequestException(`折扣必须在 ${DISCOUNT_FLOOR} ~ 1 之间`);
    }
    if (body.threshold < 0) {
      throw new BadRequestException('阈值不能为负');
    }
    const before = await this.prisma.vipConfig.findUnique({ where: { tier } });
    const updated = await this.prisma.vipConfig.update({
      where: { tier },
      data: {
        name: body.name,
        threshold: new Prisma.Decimal(body.threshold),
        defaultDiscount: new Prisma.Decimal(body.defaultDiscount),
        color: body.color ?? null,
        icon: body.icon ?? null,
        benefits: (body.benefits ?? []) as any,
      },
    });
    await this.audit.record({
      action: AuditActions.VIP_CONFIG_UPDATE,
      target: `vip:${tier}`,
      actorId: actor.id,
      actor: actor.username,
      detail: {
        before: before
          ? {
              threshold: Number(before.threshold),
              defaultDiscount: Number(before.defaultDiscount),
            }
          : null,
        after: { threshold: body.threshold, defaultDiscount: body.defaultDiscount },
      },
    });
    return updated;
  }

  // ============= 管理员：商品折扣覆盖 =============

  async listAllDiscounts(filter: { productSource?: ProductSource } = {}) {
    const items = await this.prisma.productDiscount.findMany({
      where: filter.productSource ? { productSource: filter.productSource } : {},
      orderBy: [{ productSource: 'asc' }, { productKey: 'asc' }, { tier: 'asc' }],
    });
    return items.map((d) => ({
      id: d.id,
      productSource: d.productSource,
      productKey: d.productKey,
      tier: d.tier,
      discount: Number(d.discount),
      updatedAt: d.updatedAt,
    }));
  }

  async upsertDiscount(
    body: {
      productSource: ProductSource;
      productKey: string;
      tier: Exclude<VipTier, 'NONE'>;
      discount: number;
    },
    actor: { id: number; username: string },
  ) {
    if (body.discount < DISCOUNT_FLOOR || body.discount > 1) {
      throw new BadRequestException(`折扣必须在 ${DISCOUNT_FLOOR} ~ 1 之间`);
    }
    // 验证 productKey 存在
    if (body.productSource === 'LOCAL') {
      const pid = Number(body.productKey);
      if (!Number.isFinite(pid)) {
        throw new BadRequestException('本站商品 productKey 必须是数字');
      }
      const p = await this.prisma.product.findUnique({ where: { id: pid } });
      if (!p) throw new NotFoundException('本站商品不存在');
    } else {
      const p = await this.prisma.forgeProduct.findUnique({
        where: { typeKey: body.productKey },
      });
      if (!p) throw new NotFoundException('三方商品不存在');
    }
    const item = await this.prisma.productDiscount.upsert({
      where: {
        productSource_productKey_tier: {
          productSource: body.productSource,
          productKey: body.productKey,
          tier: body.tier,
        },
      },
      update: { discount: new Prisma.Decimal(body.discount) },
      create: {
        productSource: body.productSource,
        productKey: body.productKey,
        tier: body.tier,
        discount: new Prisma.Decimal(body.discount),
      },
    });
    await this.audit.record({
      action: AuditActions.VIP_DISCOUNT_UPDATE,
      target: `${body.productSource}:${body.productKey}:${body.tier}`,
      actorId: actor.id,
      actor: actor.username,
      detail: { discount: body.discount },
    });
    return { id: item.id };
  }

  async removeDiscount(id: number, actor: { id: number; username: string }) {
    const exist = await this.prisma.productDiscount.findUnique({ where: { id } });
    if (!exist) throw new NotFoundException('折扣配置不存在');
    await this.prisma.productDiscount.delete({ where: { id } });
    await this.audit.record({
      action: AuditActions.VIP_DISCOUNT_UPDATE,
      target: `${exist.productSource}:${exist.productKey}:${exist.tier}`,
      actorId: actor.id,
      actor: actor.username,
      detail: { removed: true, oldDiscount: Number(exist.discount) },
    });
    return { ok: true };
  }

  // ============= 管理员：用户列表（带 VIP 字段） =============

  async listUsersVip(
    page = 1,
    pageSize = 20,
    filter: { keyword?: string; tier?: VipTier } = {},
  ) {
    const where: Prisma.UserWhereInput = {};
    if (filter.keyword) {
      where.OR = [
        { username: { contains: filter.keyword } },
        { email: { contains: filter.keyword } },
        { nickname: { contains: filter.keyword } },
      ];
    }
    if (filter.tier) where.vipTier = filter.tier;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ vipTier: 'desc' }, { totalRecharged: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          username: true,
          email: true,
          nickname: true,
          vipTier: true,
          totalRecharged: true,
          balance: true,
          customDiscount: true,
          vipUpgradedAt: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        nickname: u.nickname,
        vipTier: u.vipTier,
        totalRecharged: Number(u.totalRecharged),
        balance: Number(u.balance),
        customDiscount: u.customDiscount != null ? Number(u.customDiscount) : null,
        vipUpgradedAt: u.vipUpgradedAt,
        createdAt: u.createdAt,
      })),
    };
  }

  // ============= 管理员：用户专属折扣 =============

  /**
   * 给单个用户设置/清除专属折扣。
   * @param discount 0.5 ~ 1（0.9 = 9 折），传 null 清除专属折扣。
   */
  async setUserCustomDiscount(
    targetUserId: number,
    discount: number | null,
    actor: { id: number; username: string },
    note?: string,
  ) {
    if (discount !== null) {
      if (typeof discount !== 'number' || !Number.isFinite(discount)) {
        throw new BadRequestException('折扣必须是数字');
      }
      if (discount < DISCOUNT_FLOOR || discount > 1) {
        throw new BadRequestException(`折扣必须在 ${DISCOUNT_FLOOR} ~ 1 之间`);
      }
    }
    const u = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, customDiscount: true },
    });
    if (!u) throw new NotFoundException('用户不存在');

    const before = u.customDiscount != null ? Number(u.customDiscount) : null;
    // 量化到 4 位小数，与 Decimal(5,4) 对齐
    const next = discount === null ? null : Math.round(discount * 10000) / 10000;

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { customDiscount: next === null ? null : new Prisma.Decimal(next) },
    });
    await this.audit.record({
      action: AuditActions.VIP_USER_DISCOUNT_SET,
      target: `user:${targetUserId}`,
      actorId: actor.id,
      actor: actor.username,
      detail: { before, after: next, note },
    });
    return { customDiscount: next };
  }
}
