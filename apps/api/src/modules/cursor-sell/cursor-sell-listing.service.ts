import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 渠道商品 → 本站商品 的自动上架与价格/状态跟随。
 *
 * 规则存 site_settings（非密钥，直接读写）：
 *   cursor_sell_auto_list             自动上架新同步到的渠道商品（默认开）
 *   cursor_sell_auto_list_category_id 上架到哪个分类（空 = 第一个非"全部"分类）
 *   cursor_sell_markup_yuan           默认加价（元，默认 20）
 *   cursor_sell_markup_percent        默认加价比例（%，默认 0；与固定加价取高）
 *   cursor_sell_follow_offshelf       上游下架 → 本站自动下架；恢复 → 自动恢复（默认开）
 *   cursor_sell_min_margin_yuan       下单保护：售价低于 成本+该值 时拒绝下单（默认 0）
 *
 * 规格侧标记（Sku.attrs）：
 *   cursorSellCode        绑定的渠道商品
 *   cursorSellPricing     { mode:'COST_PLUS', markupYuan, markupPercent }；有 = 跟价，同步时重算
 *   cursorSellAutoListed  由自动上架创建
 *   cursorSellAutoOffShelf 被系统自动下架（上游恢复时只恢复带此标记的商品）
 */

export interface ListingRules {
  autoList: boolean;
  categoryId: number | null;
  markupYuan: number;
  markupPercent: number;
  followOffShelf: boolean;
  minMarginYuan: number;
}

export interface SkuPricing {
  mode: 'COST_PLUS';
  markupYuan: number;
  markupPercent: number;
}

export interface LocalBinding {
  productId: number;
  productTitle: string;
  productStatus: string;
  skuId: number;
  skuName: string;
  price: number;
  follow: boolean;
  autoListed: boolean;
}

const RULE_KEYS = {
  autoList: 'cursor_sell_auto_list',
  categoryId: 'cursor_sell_auto_list_category_id',
  markupYuan: 'cursor_sell_markup_yuan',
  markupPercent: 'cursor_sell_markup_percent',
  followOffShelf: 'cursor_sell_follow_offshelf',
  minMarginYuan: 'cursor_sell_min_margin_yuan',
} as const;

const TIER_LABEL: Record<string, string> = { pro: 'Pro', 'pro+': 'Pro+', ultra: 'Ultra', team: 'Team', free: 'Free' };

function attrsOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class CursorSellListingService {
  private readonly logger = new Logger(CursorSellListingService.name);

  constructor(private prisma: PrismaService) {}

  // ─────────────────────────── 规则 ───────────────────────────

  async loadRules(): Promise<ListingRules> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: Object.values(RULE_KEYS) } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = (r.value ?? '').trim();
    const bool = (v: string | undefined, dflt: boolean) => (v === undefined || v === '' ? dflt : v === 'true' || v === '1');
    const num = (v: string | undefined, dflt: number) => {
      const n = Number(v);
      return v === undefined || v === '' || !Number.isFinite(n) ? dflt : n;
    };
    const categoryRaw = num(map[RULE_KEYS.categoryId], 0);
    return {
      autoList: bool(map[RULE_KEYS.autoList], true),
      categoryId: categoryRaw > 0 ? categoryRaw : null,
      markupYuan: Math.max(0, num(map[RULE_KEYS.markupYuan], 20)),
      markupPercent: Math.max(0, num(map[RULE_KEYS.markupPercent], 0)),
      followOffShelf: bool(map[RULE_KEYS.followOffShelf], true),
      minMarginYuan: Math.max(0, num(map[RULE_KEYS.minMarginYuan], 0)),
    };
  }

  async saveRules(input: Partial<ListingRules>) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    const put = (key: string, value: string) =>
      ops.push(
        this.prisma.siteSetting.upsert({
          where: { key },
          update: { value, isPublic: false },
          create: { key, value, isPublic: false },
        }),
      );
    if (input.autoList !== undefined) put(RULE_KEYS.autoList, input.autoList ? 'true' : 'false');
    if (input.categoryId !== undefined) put(RULE_KEYS.categoryId, input.categoryId ? String(input.categoryId) : '');
    if (input.markupYuan !== undefined) put(RULE_KEYS.markupYuan, String(Math.max(0, Number(input.markupYuan) || 0)));
    if (input.markupPercent !== undefined) put(RULE_KEYS.markupPercent, String(Math.max(0, Number(input.markupPercent) || 0)));
    if (input.followOffShelf !== undefined) put(RULE_KEYS.followOffShelf, input.followOffShelf ? 'true' : 'false');
    if (input.minMarginYuan !== undefined) put(RULE_KEYS.minMarginYuan, String(Math.max(0, Number(input.minMarginYuan) || 0)));
    if (ops.length) await this.prisma.$transaction(ops);
    return this.loadRules();
  }

  /** 售价 = max(成本 + 固定加价, 成本 × (1 + 比例))，两位小数 */
  computePrice(priceCents: number, pricing: { markupYuan?: number; markupPercent?: number }): number {
    const cost = priceCents / 100;
    const byFixed = cost + Math.max(0, Number(pricing.markupYuan) || 0);
    const byPct = cost * (1 + Math.max(0, Number(pricing.markupPercent) || 0) / 100);
    return round2(Math.max(byFixed, byPct));
  }

  /** 解析规格上的跟价规则；没有 = 手工定价 */
  pricingOf(attrs: Record<string, unknown>): SkuPricing | null {
    const p = attrs.cursorSellPricing;
    if (!p || typeof p !== 'object') return null;
    const o = p as Record<string, unknown>;
    return {
      mode: 'COST_PLUS',
      markupYuan: Math.max(0, Number(o.markupYuan) || 0),
      markupPercent: Math.max(0, Number(o.markupPercent) || 0),
    };
  }

  private async resolveCategoryId(rules: ListingRules): Promise<number | null> {
    if (rules.categoryId) {
      const c = await this.prisma.category.findUnique({ where: { id: rules.categoryId } });
      if (c) return c.id;
    }
    const first = await this.prisma.category.findFirst({
      where: { slug: { not: 'all' } },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return first?.id ?? null;
  }

  // ─────────────────────────── 上架 ───────────────────────────

  /** 已绑定到各渠道商品的本站规格 */
  async findLocalBindings(codes?: string[]): Promise<Map<string, LocalBinding[]>> {
    const skus = await this.prisma.sku.findMany({
      where: { product: { deliveryType: 'CURSOR_SELL' } },
      include: { product: { select: { id: true, title: true, status: true } } },
    });
    const want = codes ? new Set(codes) : null;
    const map = new Map<string, LocalBinding[]>();
    for (const s of skus) {
      const attrs = attrsOf(s.attrs);
      const code = String(attrs.cursorSellCode || '').trim();
      if (!code || (want && !want.has(code))) continue;
      const list = map.get(code) ?? [];
      list.push({
        productId: s.product.id,
        productTitle: s.product.title,
        productStatus: s.product.status,
        skuId: s.id,
        skuName: s.name,
        price: Number(s.price),
        follow: !!this.pricingOf(attrs),
        autoListed: !!attrs.cursorSellAutoListed,
      });
      map.set(code, list);
    }
    return map;
  }

  /**
   * 把一个渠道商品上架为本站商品（一个规格，跟价）。
   * 已有规格绑定该 code 时不重复创建，直接返回已有的。
   */
  async listProduct(
    code: string,
    opts: { categoryId?: number | null; markupYuan?: number; markupPercent?: number; status?: 'ON_SALE' | 'DRAFT' } = {},
  ): Promise<{ productId: number; skuId: number; created: boolean; price: number }> {
    const up = await this.prisma.cursorSellProduct.findUnique({ where: { code } });
    if (!up) throw new NotFoundException('渠道商品不存在，请先同步');
    if (!up.active) throw new BadRequestException('该渠道商品已下架，不能上架');

    const existing = (await this.findLocalBindings([code])).get(code);
    if (existing?.length) {
      return { productId: existing[0].productId, skuId: existing[0].skuId, created: false, price: existing[0].price };
    }

    const rules = await this.loadRules();
    const categoryId = opts.categoryId ?? (await this.resolveCategoryId(rules));
    if (!categoryId) throw new BadRequestException('没有可用分类，请先在「分类」里新建一个');
    const pricing: SkuPricing = {
      mode: 'COST_PLUS',
      markupYuan: opts.markupYuan ?? rules.markupYuan,
      markupPercent: opts.markupPercent ?? rules.markupPercent,
    };
    const price = this.computePrice(up.priceCents, pricing);
    const fields = Array.isArray(up.deliveryFields) ? (up.deliveryFields as string[]) : [];
    const mode = up.extractOnly ? 'extract' : fields.includes('login') ? 'login' : fields.includes('card') ? 'card' : 'account';
    const tierLabel = TIER_LABEL[up.tier.toLowerCase()] || up.tier.toUpperCase();

    const product = await this.prisma.product.create({
      data: {
        categoryId,
        title: up.title,
        subtitle: [tierLabel, up.warrantyHours ? `质保 ${up.warrantyHours} 小时` : null, up.ondemandTeam ? '现做开通' : '自动发货']
          .filter(Boolean)
          .join(' · '),
        description: this.buildDescription(mode, up.ondemandTeam, up.warrantyHours),
        tags: ['Team 渠道', tierLabel] as Prisma.InputJsonValue,
        basePrice: price,
        status: opts.status ?? 'ON_SALE',
        deliveryType: 'CURSOR_SELL',
        warranty: up.warrantyHours ? `售后保障 ${up.warrantyHours} 小时，期间账号异常请凭订单号联系客服` : null,
        pointsAwardEnabled: true,
        pointsPayEnabled: false,
        skus: {
          create: [
            {
              name: tierLabel,
              price,
              sort: 0,
              visible: true,
              attrs: {
                cursorSellCode: code,
                cursorSellPricing: { ...pricing },
                cursorSellAutoListed: true,
              } as unknown as Prisma.InputJsonValue,
            },
          ],
        },
      },
      include: { skus: true },
    });
    this.logger.log(`auto-listed ${code} → product #${product.id} at ¥${price}`);
    return { productId: product.id, skuId: product.skus[0].id, created: true, price };
  }

  async listBatch(codes: string[], opts: { categoryId?: number | null; markupYuan?: number; markupPercent?: number } = {}) {
    const results: Array<{ code: string; ok: boolean; created?: boolean; productId?: number; error?: string }> = [];
    for (const code of Array.from(new Set(codes.map((c) => c.trim()).filter(Boolean)))) {
      try {
        const r = await this.listProduct(code, opts);
        results.push({ code, ok: true, created: r.created, productId: r.productId });
      } catch (e) {
        results.push({ code, ok: false, error: (e as Error).message });
      }
    }
    return {
      total: results.length,
      created: results.filter((r) => r.ok && r.created).length,
      existed: results.filter((r) => r.ok && !r.created).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  private buildDescription(mode: string, ondemand: boolean, warrantyHours: number | null): string {
    const parts: string[] = [];
    if (mode === 'login') {
      parts.push('<p>本商品为 <b>授权登录</b> 型 Team 账号：付款后订单页会显示账号邮箱和授权步骤，在 Cursor 客户端点登录，把浏览器里的登录链接粘贴到订单页即可完成登录，无需 Token。</p>');
    } else if (mode === 'extract') {
      parts.push('<p>本商品为 <b>提取卡</b>：付款后订单页显示提取码，按提示到渠道提取页领取账号，每次提取消耗 1 次。</p>');
    } else if (mode === 'card') {
      parts.push('<p>付款后订单页显示卡密及使用说明。</p>');
    } else {
      parts.push('<p>付款后系统自动发货，订单页可查看邮箱 / 密码 / Token 并一键复制，支持查看账号额度。</p>');
    }
    if (ondemand) parts.push('<p>该账号为 <b>现做开通</b>，付款后通常几分钟内完成，订单页会自动刷新显示凭据。</p>');
    if (warrantyHours) parts.push(`<p>售后保障 ${warrantyHours} 小时，期间账号异常请凭订单号联系客服。</p>`);
    parts.push('<p>请勿在多台设备频繁切换登录，避免触发风控。</p>');
    return parts.join('');
  }

  // ─────────────────────────── 同步后的跟随 ───────────────────────────

  /**
   * 商品缓存同步完成后调用：自动上架新商品、重算跟价规格、上游下架/恢复联动。
   */
  async applyAfterSync(): Promise<{ listed: number; repriced: number; offShelf: number; restored: number }> {
    const rules = await this.loadRules();
    const upstream = await this.prisma.cursorSellProduct.findMany();
    const upMap = new Map(upstream.map((p) => [p.code, p]));

    const skus = await this.prisma.sku.findMany({
      where: { product: { deliveryType: 'CURSOR_SELL' } },
      include: { product: { select: { id: true, status: true } } },
    });

    // 1) 自动上架
    let listed = 0;
    if (rules.autoList) {
      const bound = new Set(
        skus.map((s) => String(attrsOf(s.attrs).cursorSellCode || '').trim()).filter(Boolean),
      );
      for (const up of upstream) {
        if (!up.active || bound.has(up.code)) continue;
        try {
          const r = await this.listProduct(up.code);
          if (r.created) listed++;
        } catch (e) {
          this.logger.warn(`auto-list ${up.code} skipped: ${(e as Error).message}`);
        }
      }
    }

    // 2) 跟价重算
    let repriced = 0;
    const touchedProducts = new Set<number>();
    for (const s of skus) {
      const attrs = attrsOf(s.attrs);
      const code = String(attrs.cursorSellCode || '').trim();
      const pricing = this.pricingOf(attrs);
      const up = code ? upMap.get(code) : undefined;
      if (!pricing || !up || !up.active) continue;
      const price = this.computePrice(up.priceCents, pricing);
      if (Math.abs(price - Number(s.price)) >= 0.005) {
        await this.prisma.sku.update({ where: { id: s.id }, data: { price } });
        touchedProducts.add(s.productId);
        repriced++;
      }
    }
    for (const productId of touchedProducts) await this.syncBasePrice(productId);

    // 3) 上游下架 → 本站下架；上游恢复 → 恢复我们自动下架的
    let offShelf = 0;
    let restored = 0;
    if (rules.followOffShelf) {
      const byProduct = new Map<number, typeof skus>();
      for (const s of skus) {
        const list = byProduct.get(s.productId) ?? [];
        list.push(s);
        byProduct.set(s.productId, list);
      }
      for (const [productId, list] of byProduct) {
        const status = list[0].product.status;
        const bound = list
          .map((s) => String(attrsOf(s.attrs).cursorSellCode || '').trim())
          .filter(Boolean);
        if (!bound.length) continue;
        const allInactive = bound.every((c) => !upMap.get(c)?.active);
        const allActive = bound.every((c) => !!upMap.get(c)?.active);
        const autoOff = list.some((s) => !!attrsOf(s.attrs).cursorSellAutoOffShelf);

        if (status === 'ON_SALE' && allInactive) {
          await this.prisma.$transaction(async (tx) => {
            await tx.product.update({ where: { id: productId }, data: { status: 'OFF_SHELF' } });
            for (const s of list) {
              await tx.sku.update({
                where: { id: s.id },
                data: { attrs: { ...attrsOf(s.attrs), cursorSellAutoOffShelf: true } as Prisma.InputJsonValue },
              });
            }
          });
          offShelf++;
        } else if (status === 'OFF_SHELF' && autoOff && allActive) {
          await this.prisma.$transaction(async (tx) => {
            await tx.product.update({ where: { id: productId }, data: { status: 'ON_SALE' } });
            for (const s of list) {
              const { cursorSellAutoOffShelf: _drop, ...rest } = attrsOf(s.attrs);
              await tx.sku.update({ where: { id: s.id }, data: { attrs: rest as Prisma.InputJsonValue } });
            }
          });
          restored++;
        }
      }
    }

    if (listed || repriced || offShelf || restored) {
      this.logger.log(`listing follow: listed=${listed} repriced=${repriced} offShelf=${offShelf} restored=${restored}`);
    }
    return { listed, repriced, offShelf, restored };
  }

  /** 单个商品保存后：按跟价规则重算其规格价格与起价（商品编辑保存时调用） */
  async repriceProduct(productId: number): Promise<number> {
    const skus = await this.prisma.sku.findMany({ where: { productId } });
    let changed = 0;
    for (const s of skus) {
      const attrs = attrsOf(s.attrs);
      const pricing = this.pricingOf(attrs);
      const code = String(attrs.cursorSellCode || '').trim();
      if (!pricing || !code) continue;
      const up = await this.prisma.cursorSellProduct.findUnique({ where: { code } });
      if (!up) continue;
      const price = this.computePrice(up.priceCents, pricing);
      if (Math.abs(price - Number(s.price)) >= 0.005) {
        await this.prisma.sku.update({ where: { id: s.id }, data: { price } });
        changed++;
      }
    }
    await this.syncBasePrice(productId);
    return changed;
  }

  private async syncBasePrice(productId: number) {
    const agg = await this.prisma.sku.aggregate({
      where: { productId, visible: true },
      _min: { price: true },
    });
    if (agg._min.price != null) {
      await this.prisma.product.update({ where: { id: productId }, data: { basePrice: agg._min.price } });
    }
  }

  // ─────────────────────────── 下单保护 ───────────────────────────

  /**
   * 下单前校验：售价不得低于 成本 + 保底利润。
   * 调用方需先保证缓存足够新（CatalogService.ensureFresh）。
   */
  async assertSellable(skuPrice: number, priceCents: number, skuAttrs: unknown): Promise<void> {
    const rules = await this.loadRules();
    const floor = priceCents / 100 + rules.minMarginYuan;
    if (skuPrice + 0.005 < floor) {
      const follow = !!this.pricingOf(attrsOf(skuAttrs));
      throw new BadRequestException(
        follow
          ? '渠道价格刚刚变动，请刷新页面后重新下单'
          : '该规格当前售价低于渠道成本，暂不可售，请联系客服',
      );
    }
  }
}
