import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface BulkItem {
  sourceRef?: string;
  content: string;
  email?: string;
  remark?: string;
}

/** 仓库 content = email----emailpwd----cursorpwd----token */
const WAREHOUSE_SEPARATOR = '----';

/** 从仓库 content 解析邮箱（取第一段，需含 @），用于发货 / 入库自动回填 email 列 */
function parseEmailFromContent(fullContent: string): string | null {
  const first = (fullContent || '').split(WAREHOUSE_SEPARATOR)[0]?.trim() ?? '';
  return first.includes('@') ? first.slice(0, 255) : null;
}

/** 售出发货只给 邮箱（买家用邮箱验证码登录，不下发邮箱密码 / cursor 密码 / token） */
function buildDeliveryContent(fullContent: string): string {
  const email = parseEmailFromContent(fullContent);
  // 兜底：解析不到邮箱时原样发货，避免发空
  return email || (fullContent || '').trim();
}

@Injectable()
export class WarehouseService {
  private readonly logger = new Logger(WarehouseService.name);

  constructor(private prisma: PrismaService) {}

  // ====== 外部推送：批量入库 ======

  async bulkImport(items: BulkItem[]) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('items 不能为空');
    }
    if (items.length > 1000) {
      throw new BadRequestException('单次最多导入 1000 条');
    }

    const created: any[] = [];
    const updated: any[] = [];
    const skipped: { reason: string; item: BulkItem }[] = [];

    for (const raw of items) {
      const item: BulkItem = {
        sourceRef: typeof raw.sourceRef === 'string' ? raw.sourceRef.trim().slice(0, 128) : undefined,
        content: typeof raw.content === 'string' ? raw.content.trim() : '',
        email: typeof raw.email === 'string' ? raw.email.trim().slice(0, 255) : undefined,
        remark: typeof raw.remark === 'string' ? raw.remark.slice(0, 500) : undefined,
      };
      if (!item.content || item.content.length > 4096) {
        skipped.push({ reason: 'content 缺失或过长', item: raw });
        continue;
      }

      try {
        if (item.sourceRef) {
          const existing = await this.prisma.warehouseAccount.findUnique({
            where: { sourceRef: item.sourceRef },
          });
          if (existing) {
            const r = await this.prisma.warehouseAccount.update({
              where: { id: existing.id },
              data: {
                // 已分配 / 已售出的不应被外部改 content
                content: existing.status === 'PENDING' ? item.content : existing.content,
                email: item.email ?? existing.email,
                remark: item.remark ?? existing.remark,
              },
            });
            updated.push(this.toView(r));
            continue;
          }
        }
        const r = await this.prisma.warehouseAccount.create({
          data: {
            sourceRef: item.sourceRef ?? null,
            content: item.content,
            email: item.email ?? null,
            remark: item.remark ?? null,
            status: 'PENDING',
          },
        });
        created.push(this.toView(r));
      } catch (e: any) {
        skipped.push({ reason: e?.message || String(e), item: raw });
      }
    }
    return {
      total: items.length,
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      items: { created, updated, skipped },
    };
  }

  // ====== 管理后台：手动添加账号入库（一行一条，自动解析邮箱） ======

  /**
   * 后台手动灌入仓库：raw 为多行文本，一行一条 content
   * （如 email----emailpwd----cursorpwd----token，或只填 email）。
   * 库内已存在相同 content 的自动跳过；email 列从 content 第一段解析回填。
   */
  async manualAdd(raw: string, remark?: string) {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new BadRequestException('请填写账号内容');
    }
    const lines = Array.from(
      new Set(
        raw
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    if (!lines.length) {
      throw new BadRequestException('请填写账号内容');
    }
    if (lines.length > 1000) {
      throw new BadRequestException('单次最多添加 1000 条');
    }
    for (const l of lines) {
      if (l.length > 4096) {
        throw new BadRequestException('存在单条超过 4KB 的内容，请检查输入');
      }
    }

    // 库内已存在相同 content 的（任意状态）跳过，避免重复入库
    const existing = await this.prisma.warehouseAccount.findMany({
      where: { content: { in: lines } },
      select: { content: true },
    });
    const existSet = new Set(existing.map((e) => e.content));
    const fresh = lines.filter((l) => !existSet.has(l));
    if (!fresh.length) {
      return { total: lines.length, created: 0, duplicated: lines.length };
    }

    const trimmedRemark =
      typeof remark === 'string' && remark.trim() ? remark.trim().slice(0, 500) : null;
    const r = await this.prisma.warehouseAccount.createMany({
      data: fresh.map((content) => ({
        sourceRef: null,
        content,
        email: parseEmailFromContent(content),
        remark: trimmedRemark,
        status: 'PENDING',
      })),
    });
    return {
      total: lines.length,
      created: r.count,
      duplicated: lines.length - r.count,
    };
  }

  // ====== 反查：按 sourceRef 列表批量返回状态（供外部系统同步用） ======

  async statusBySourceRefs(refs: string[]) {
    if (!Array.isArray(refs) || refs.length === 0) return [];
    if (refs.length > 1000) {
      throw new BadRequestException('单次最多查 1000 个');
    }
    const rows = await this.prisma.warehouseAccount.findMany({
      where: { sourceRef: { in: refs } },
    });

    // 附带商品名 / SKU 名，方便外部系统直接展示
    const productIds = Array.from(
      new Set(rows.map((r) => r.productId).filter((x): x is number => x != null)),
    );
    const skuIds = Array.from(
      new Set(rows.map((r) => r.skuId).filter((x): x is number => x != null)),
    );
    const [products, skus] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      skuIds.length
        ? this.prisma.sku.findMany({
            where: { id: { in: skuIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p.title]));
    const skuMap = new Map(skus.map((s) => [s.id, s.name]));

    return rows.map((r) => ({
      ...this.toView(r),
      productTitle: r.productId ? productMap.get(r.productId) ?? null : null,
      skuName: r.skuId ? skuMap.get(r.skuId) ?? null : null,
    }));
  }

  // ====== 管理后台：列表 / 分配 / 撤回 / 删除 ======

  async list(params: {
    status?: string;
    sourceRef?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.sourceRef) where.sourceRef = { contains: params.sourceRef };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.warehouseAccount.count({ where }),
      this.prisma.warehouseAccount.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // attach product/sku names
    const productIds = Array.from(
      new Set(items.map((i) => i.productId).filter((x): x is number => x != null)),
    );
    const skuIds = Array.from(
      new Set(items.map((i) => i.skuId).filter((x): x is number => x != null)),
    );
    const [products, skus] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      skuIds.length
        ? this.prisma.sku.findMany({
            where: { id: { in: skuIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p.title]));
    const skuMap = new Map(skus.map((s) => [s.id, s.name]));

    return {
      total,
      page,
      pageSize,
      items: items.map((i) => ({
        ...this.toView(i),
        productTitle: i.productId ? productMap.get(i.productId) ?? null : null,
        skuName: i.skuId ? skuMap.get(i.skuId) ?? null : null,
      })),
    };
  }

  async assign(id: number, productId: number, skuId: number) {
    const wa = await this.prisma.warehouseAccount.findUnique({ where: { id } });
    if (!wa) throw new NotFoundException('仓库账号不存在');
    if (wa.status !== 'PENDING') {
      throw new BadRequestException(`仓库账号当前状态为 ${wa.status}，不能再次分配`);
    }
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
    if (!sku) throw new NotFoundException('SKU 不存在');
    if (sku.productId !== productId) {
      throw new BadRequestException('SKU 不属于该商品');
    }

    return this.prisma.$transaction(async (tx) => {
      const cardKey = await tx.cardKey.create({
        data: {
          productId,
          skuId,
          // 发货只给 邮箱 + token；完整账号信息仍保留在 warehouse_accounts.content
          content: buildDeliveryContent(wa.content),
          remark: wa.remark ?? `from warehouse #${wa.id}`,
          status: 'AVAILABLE',
        },
      });
      const updated = await tx.warehouseAccount.update({
        where: { id: wa.id },
        data: {
          status: 'ASSIGNED',
          productId,
          skuId,
          cardKeyId: cardKey.id,
          assignedAt: new Date(),
        },
      });
      return this.toView(updated);
    });
  }

  async unassign(id: number) {
    const wa = await this.prisma.warehouseAccount.findUnique({ where: { id } });
    if (!wa) throw new NotFoundException('仓库账号不存在');
    if (wa.status !== 'ASSIGNED') {
      throw new BadRequestException(`只有 ASSIGNED 状态可以撤回（当前 ${wa.status}）`);
    }
    if (!wa.cardKeyId) {
      throw new BadRequestException('没有关联的 CardKey');
    }
    const ck = await this.prisma.cardKey.findUnique({ where: { id: wa.cardKeyId } });
    if (ck && ck.status !== 'AVAILABLE') {
      throw new BadRequestException(`关联的 CardKey 不是 AVAILABLE 状态（${ck.status}），不能撤回`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (wa.cardKeyId) {
        await tx.cardKey.delete({ where: { id: wa.cardKeyId } }).catch(() => null);
      }
      const updated = await tx.warehouseAccount.update({
        where: { id: wa.id },
        data: {
          status: 'PENDING',
          productId: null,
          skuId: null,
          cardKeyId: null,
          assignedAt: null,
        },
      });
      return this.toView(updated);
    });
  }

  async remove(id: number) {
    const wa = await this.prisma.warehouseAccount.findUnique({ where: { id } });
    if (!wa) throw new NotFoundException('仓库账号不存在');
    if (wa.status === 'ASSIGNED' && wa.cardKeyId) {
      const ck = await this.prisma.cardKey.findUnique({ where: { id: wa.cardKeyId } });
      if (ck && ck.status === 'AVAILABLE') {
        await this.prisma.cardKey.delete({ where: { id: wa.cardKeyId } }).catch(() => null);
      }
    }
    await this.prisma.warehouseAccount.delete({ where: { id: wa.id } });
    return { ok: true };
  }

  // ====== 外部系统（cursor-jb）按 sourceRef 联动 ======

  /** 下架：标记 UNLISTED；若关联 CardKey 仍 AVAILABLE 则下架（删除卡密，避免被买） */
  async unlistByRef(sourceRef: string) {
    const wa = await this.prisma.warehouseAccount.findUnique({ where: { sourceRef } });
    if (!wa) return { ok: false, reason: 'not_found' };
    return this.prisma.$transaction(async (tx) => {
      if (wa.cardKeyId) {
        const ck = await tx.cardKey.findUnique({ where: { id: wa.cardKeyId } });
        if (ck && ck.status === 'AVAILABLE') {
          await tx.cardKey.delete({ where: { id: ck.id } }).catch(() => null);
          await tx.warehouseAccount.update({
            where: { id: wa.id },
            data: { status: 'UNLISTED', cardKeyId: null, productId: null, skuId: null },
          });
          return { ok: true, status: 'UNLISTED', cardKeyRemoved: true };
        }
      }
      // 已售出 / 无可下架卡密：仅标记 UNLISTED，保留 CardKey 和订单
      await tx.warehouseAccount.update({ where: { id: wa.id }, data: { status: 'UNLISTED' } });
      return { ok: true, status: 'UNLISTED', cardKeyRemoved: false };
    });
  }

  /** 恢复：UNLISTED -> PENDING（回到未分配，admin 可重新分配） */
  async relistByRef(sourceRef: string) {
    const wa = await this.prisma.warehouseAccount.findUnique({ where: { sourceRef } });
    if (!wa) return { ok: false, reason: 'not_found' };
    if (wa.status !== 'UNLISTED') return { ok: true, status: wa.status };
    await this.prisma.warehouseAccount.update({
      where: { id: wa.id },
      data: { status: 'PENDING' },
    });
    return { ok: true, status: 'PENDING' };
  }

  /** 删除：只删仓库记录，保留 CardKey / 订单等 faka 业务数据 */
  async deleteByRef(sourceRef: string) {
    const wa = await this.prisma.warehouseAccount.findUnique({ where: { sourceRef } });
    if (!wa) return { ok: false, reason: 'not_found' };
    await this.prisma.warehouseAccount.delete({ where: { id: wa.id } });
    return { ok: true, deleted: true, keptCardKey: wa.cardKeyId ?? null };
  }

  /** 由 OrdersService 在卡密 SOLD 后调用 */
  async markSoldByCardKeyIds(cardKeyIds: number[], orderNo: string, soldAt: Date) {
    if (!cardKeyIds.length) return { updated: 0 };
    const r = await this.prisma.warehouseAccount.updateMany({
      where: { cardKeyId: { in: cardKeyIds } },
      data: { status: 'SOLD', soldAt, orderNo },
    });
    return { updated: r.count };
  }

  private toView(r: any) {
    return {
      id: r.id,
      sourceRef: r.sourceRef,
      content: r.content,
      email: r.email,
      remark: r.remark,
      status: r.status,
      productId: r.productId,
      skuId: r.skuId,
      cardKeyId: r.cardKeyId,
      assignedAt: r.assignedAt,
      soldAt: r.soldAt,
      orderNo: r.orderNo,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
