import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CursorSellService } from './cursor-sell.service';
import { UpstreamProduct } from './cursor-sell.types';

/**
 * 上游商品缓存：同步 GET /products 到 cursor_sell_products。
 * 缓存用于：后台商品绑定下拉、前台库存展示、采购成本快照。
 */
@Injectable()
export class CursorSellCatalogService {
  private readonly logger = new Logger(CursorSellCatalogService.name);

  constructor(
    private prisma: PrismaService,
    private api: CursorSellService,
  ) {}

  /** 拉取上游商品并 upsert；上游不再返回的商品置 active=false */
  async sync(): Promise<{ upserted: number; deactivated: number; syncedAt: string }> {
    const list = await this.api.listProducts();
    const now = new Date();
    const codes: string[] = [];
    for (const p of list) {
      if (!p?.code) continue;
      codes.push(p.code);
      const fields = Array.isArray(p.deliveryFields) ? p.deliveryFields : [];
      await this.prisma.cursorSellProduct.upsert({
        where: { code: p.code },
        create: {
          code: p.code,
          title: String(p.title || p.code).slice(0, 128),
          tier: String(p.tier || '').slice(0, 32),
          priceCents: Math.max(0, Math.round(Number(p.priceCents) || 0)),
          warrantyHours: p.warrantyHours == null ? null : Number(p.warrantyHours),
          deliveryFields: fields as Prisma.InputJsonValue,
          stock: Math.max(0, Math.round(Number(p.stock) || 0)),
          extractOnly: !!p.extractOnly,
          ondemandTeam: !!p.ondemandTeam,
          active: true,
          raw: p as unknown as Prisma.InputJsonValue,
          lastSyncAt: now,
        },
        update: {
          title: String(p.title || p.code).slice(0, 128),
          tier: String(p.tier || '').slice(0, 32),
          priceCents: Math.max(0, Math.round(Number(p.priceCents) || 0)),
          warrantyHours: p.warrantyHours == null ? null : Number(p.warrantyHours),
          deliveryFields: fields as Prisma.InputJsonValue,
          stock: Math.max(0, Math.round(Number(p.stock) || 0)),
          extractOnly: !!p.extractOnly,
          ondemandTeam: !!p.ondemandTeam,
          active: true,
          raw: p as unknown as Prisma.InputJsonValue,
          lastSyncAt: now,
        },
      });
    }
    const deactivated = await this.prisma.cursorSellProduct.updateMany({
      where: { active: true, ...(codes.length ? { code: { notIn: codes } } : {}) },
      data: { active: false },
    });
    this.logger.log(`cursor-sell products synced: ${codes.length} upserted, ${deactivated.count} deactivated`);
    return { upserted: codes.length, deactivated: deactivated.count, syncedAt: now.toISOString() };
  }

  /** 后台列表（含下架的） */
  async list(opts: { activeOnly?: boolean } = {}) {
    const rows = await this.prisma.cursorSellProduct.findMany({
      where: opts.activeOnly ? { active: true } : undefined,
      orderBy: [{ active: 'desc' }, { tier: 'asc' }, { priceCents: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async get(code: string) {
    const r = await this.prisma.cursorSellProduct.findUnique({ where: { code } });
    return r ? this.toView(r) : null;
  }

  /** 各上游商品的预估库存：供本站 CURSOR_SELL 商品的 SKU 展示 */
  async stockByCode(codes: string[]): Promise<Record<string, number>> {
    if (!codes.length) return {};
    const rows = await this.prisma.cursorSellProduct.findMany({
      where: { code: { in: codes } },
      select: { code: true, stock: true, active: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.code] = r.active ? r.stock : 0;
    return out;
  }

  async lastSyncAt(): Promise<Date | null> {
    const r = await this.prisma.cursorSellProduct.findFirst({
      orderBy: { lastSyncAt: 'desc' },
      select: { lastSyncAt: true },
    });
    return r?.lastSyncAt ?? null;
  }

  toView(r: {
    code: string;
    title: string;
    tier: string;
    priceCents: number;
    warrantyHours: number | null;
    deliveryFields: Prisma.JsonValue;
    stock: number;
    extractOnly: boolean;
    ondemandTeam: boolean;
    active: boolean;
    lastSyncAt: Date | null;
  }) {
    const fields = Array.isArray(r.deliveryFields) ? (r.deliveryFields as string[]) : [];
    return {
      code: r.code,
      title: r.title,
      tier: r.tier,
      priceCents: r.priceCents,
      price: r.priceCents / 100,
      warrantyHours: r.warrantyHours,
      deliveryFields: fields,
      deliveryMode: r.extractOnly
        ? 'extract'
        : fields.includes('login')
          ? 'login'
          : fields.includes('card')
            ? 'card'
            : 'account',
      stock: r.stock,
      extractOnly: r.extractOnly,
      ondemandTeam: r.ondemandTeam,
      active: r.active,
      lastSyncAt: r.lastSyncAt,
    };
  }

  /** 供其它服务复用：把上游原始商品转成快照文本 */
  static describe(p: UpstreamProduct | { title: string; code: string }) {
    return `${p.title}（${p.code}）`;
  }
}
