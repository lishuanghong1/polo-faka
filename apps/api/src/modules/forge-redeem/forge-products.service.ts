import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ForgeOpenapiService, ForgeApiError } from '../forge-openapi/forge-openapi.service';
import { UpdateForgeProductDto } from './dto';

/**
 * 商品数据职责：
 * - 管理员：手动「同步」商品（拉 /products → upsert 本地表 → 默认未上架，需要逐个启用）
 * - 前台：实时调三方 /products，叠加本地「上架 / 售价」过滤；
 *   30s 内存缓存兜底，避免被限流（三方 60 次/分钟）
 */

interface PublicProductItem {
  typeKey: string;
  categoryKey: string;
  categoryName: string;
  typeName: string;
  displayPrice: number; // 本站售价（CNY）
  agentPrice: number;   // 三方代理价（我方成本，仅展示给管理员）
  stock: number;
  warrantyHours: number | null;
  emailCodeEnabled: boolean;
}

interface UpstreamRaw {
  categories: Array<{
    category_key: string;
    category_name: string;
    types: Array<{
      type_key: string;
      type_name: string;
      price: number;
      agent_price: number;
      stock: number;
      warranty_hours?: number;
      email_code_enabled?: boolean;
    }>;
  }>;
}

const PUBLIC_CACHE_TTL_MS = 30_000;

@Injectable()
export class ForgeProductsService {
  private readonly logger = new Logger(ForgeProductsService.name);

  private upstreamCache: { at: number; data: UpstreamRaw } | null = null;
  private upstreamInflight: Promise<UpstreamRaw> | null = null;

  constructor(
    private prisma: PrismaService,
    private forge: ForgeOpenapiService,
  ) {}

  /** 管理员触发：拉三方商品 → upsert 本地表 */
  async syncProducts() {
    const upstream = await this.fetchUpstream(true);
    const cats = upstream?.categories || [];
    let upserted = 0;
    for (const cat of cats) {
      for (const t of cat.types || []) {
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
    return { upserted, syncedAt: new Date() };
  }

  /** 管理员列表 */
  async listAdmin() {
    const rows = await this.prisma.forgeProduct.findMany({
      orderBy: [{ enabled: 'desc' }, { sort: 'asc' }, { typeKey: 'asc' }],
    });
    return rows.map((r) => ({
      ...r,
      price: Number(r.price),
      agentPrice: Number(r.agentPrice),
      displayPrice: Number(r.displayPrice),
    }));
  }

  async update(typeKey: string, dto: UpdateForgeProductDto) {
    const exists = await this.prisma.forgeProduct.findUnique({ where: { typeKey } });
    if (!exists) throw new NotFoundException('商品不存在');
    const r = await this.prisma.forgeProduct.update({
      where: { typeKey },
      data: {
        ...(dto.displayPrice !== undefined && {
          displayPrice: new Prisma.Decimal(dto.displayPrice),
        }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.sort !== undefined && { sort: dto.sort }),
      },
    });
    return r;
  }

  /** 拿单个 enabled 商品（用于下单时校验 + 计价） */
  async getEnabledOrThrow(typeKey: string) {
    const p = await this.prisma.forgeProduct.findUnique({ where: { typeKey } });
    if (!p || !p.enabled) throw new NotFoundException('该商品不存在或未上架');
    return p;
  }

  /**
   * 前台：实时调三方 + 30s 内存缓存兜底 + 本地 displayPrice/enabled 叠加。
   * 三方挂了仍 fallback 到本地缓存表，保障可用性。
   */
  async listPublic(): Promise<PublicProductItem[]> {
    // 本地配置（决定哪些上架 + 售价）
    const localRows = await this.prisma.forgeProduct.findMany({
      where: { enabled: true },
      orderBy: [{ sort: 'asc' }, { displayPrice: 'asc' }],
    });
    if (!localRows.length) return [];

    const localMap = new Map(localRows.map((r) => [r.typeKey, r]));

    let upstream: UpstreamRaw | null = null;
    try {
      upstream = await this.fetchUpstream(false);
    } catch (e) {
      this.logger.warn(
        `live upstream products fetch failed, fallback to db cache: ${(e as Error).message}`,
      );
    }

    // 上游不可用：fallback 到本地表数据
    if (!upstream) {
      return localRows.map((r) => ({
        typeKey: r.typeKey,
        categoryKey: r.categoryKey,
        categoryName: r.categoryName,
        typeName: r.typeName,
        displayPrice: Number(r.displayPrice),
        agentPrice: Number(r.agentPrice),
        stock: r.stock,
        warrantyHours: r.warrantyHours,
        emailCodeEnabled: r.emailCodeEnabled,
      }));
    }

    // 上游可用：用上游的库存/名称 + 本地的售价/启用过滤
    const result: PublicProductItem[] = [];
    for (const cat of upstream.categories) {
      for (const t of cat.types) {
        const local = localMap.get(t.type_key);
        if (!local) continue; // 本地未上架
        result.push({
          typeKey: t.type_key,
          categoryKey: cat.category_key,
          categoryName: cat.category_name,
          typeName: t.type_name,
          displayPrice: Number(local.displayPrice),
          agentPrice: Number(t.agent_price ?? local.agentPrice),
          stock: Number.isInteger(t.stock) ? t.stock : 0,
          warrantyHours: t.warranty_hours ?? local.warrantyHours,
          emailCodeEnabled: !!t.email_code_enabled,
        });
      }
    }

    // 按本地 sort 排序
    result.sort((a, b) => {
      const sa = localMap.get(a.typeKey)?.sort ?? 0;
      const sb = localMap.get(b.typeKey)?.sort ?? 0;
      if (sa !== sb) return sa - sb;
      return a.displayPrice - b.displayPrice;
    });
    return result;
  }

  /** 拿单个商品（前台详情用） */
  async getPublic(typeKey: string): Promise<PublicProductItem | null> {
    const list = await this.listPublic();
    return list.find((p) => p.typeKey === typeKey) || null;
  }

  /** 失效缓存（管理员保存售价 / 上下架后调用） */
  invalidateCache() {
    this.upstreamCache = null;
  }

  /**
   * 拉三方 /products，带 30s 内存缓存 + 单飞模式（防并发打爆三方）。
   * force=true 时跳过缓存。
   */
  private async fetchUpstream(force: boolean): Promise<UpstreamRaw> {
    if (!force && this.upstreamCache && Date.now() - this.upstreamCache.at < PUBLIC_CACHE_TTL_MS) {
      return this.upstreamCache.data;
    }
    if (this.upstreamInflight) {
      return this.upstreamInflight;
    }
    this.upstreamInflight = (async () => {
      try {
        const r = await this.forge.request<UpstreamRaw>('GET', '/openapi/v1/products');
        const data = r.data || ({ categories: [] } as UpstreamRaw);
        this.upstreamCache = { at: Date.now(), data };
        return data;
      } finally {
        this.upstreamInflight = null;
      }
    })();
    return this.upstreamInflight;
  }
}
