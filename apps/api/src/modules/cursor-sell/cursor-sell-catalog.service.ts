import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CursorSellService } from './cursor-sell.service';
import { CursorSellListingService } from './cursor-sell-listing.service';
import { UpstreamProduct } from './cursor-sell.types';

export interface SyncResult {
  upserted: number;
  deactivated: number;
  syncedAt: string;
  listing: { listed: number; repriced: number; offShelf: number; restored: number };
}

/** 缓存超过这个时长视为"陈旧"，下单前会先刷一次（cron 每 5 分钟同步，正常不会触发） */
const FRESH_MS = 6 * 60 * 1000;

/**
 * 上游商品缓存：同步 GET /products 到 cursor_sell_products。
 * 缓存用于：后台商品绑定下拉、前台库存展示、采购成本快照。
 * 同步完成后交给 ListingService 做自动上架 / 跟价 / 下架联动。
 */
@Injectable()
export class CursorSellCatalogService {
  private readonly logger = new Logger(CursorSellCatalogService.name);
  private inflight: Promise<SyncResult> | null = null;

  constructor(
    private prisma: PrismaService,
    private api: CursorSellService,
    private listing: CursorSellListingService,
  ) {}

  /** 并发去重：同一时刻只跑一次同步，其余调用等待同一个结果 */
  sync(): Promise<SyncResult> {
    if (!this.inflight) {
      this.inflight = this.doSync().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** 缓存陈旧时同步一次；失败不抛（下单流程不因上游抖动被卡住，仍按缓存价校验） */
  async ensureFresh(): Promise<void> {
    const last = await this.lastSyncAt();
    if (last && Date.now() - last.getTime() < FRESH_MS) return;
    try {
      await this.sync();
    } catch (e) {
      this.logger.warn(`ensureFresh sync failed: ${(e as Error).message}`);
    }
  }

  /** 拉取上游商品并 upsert；上游不再返回的商品置 active=false */
  private async doSync(): Promise<SyncResult> {
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

    let listing = { listed: 0, repriced: 0, offShelf: 0, restored: 0 };
    try {
      listing = await this.listing.applyAfterSync();
    } catch (e) {
      this.logger.error(`listing follow failed: ${(e as Error).message}`, (e as Error).stack);
    }
    return { upserted: codes.length, deactivated: deactivated.count, syncedAt: now.toISOString(), listing };
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
