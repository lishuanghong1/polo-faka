import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptString, decryptString, isEncrypted } from '../../common/crypto.util';
import { WarehouseService } from '../warehouse/warehouse.service';
import { CursorUsageService } from './cursor-usage.service';
import { CursorCheckoutService } from './cursor-checkout.service';
import {
  BulkImportCursorSubDto,
  CreateCursorSubDto,
  MigrateCursorSubItemDto,
  UpdateCursorSubDto,
} from './dto';

const SEPARATOR = '----';
const COMMON_SEPARATORS = ['----', '\t', '|', ',', '::'];
const LABELED_RE = /workos[_ ]?cursor[_ ]?session[_ ]?token|access[_ ]?token|session[_ ]?token/i;
const EMAIL_LABEL_RE = /(邮箱|mail|账号|account)\s*[:：]/i;

/** 免费 / 非付费的 membershipType（其余一律视为付费，如 pro/pro_plus/ultra/business…） */
const FREE_MEMBERSHIPS = new Set(['free', 'free_trial', 'trial', 'none', 'free_tier', 'hobby']);

/** membershipType 是否为「付费订阅」（pro 及以上） */
function isPaidMembership(membershipType: string | null | undefined): boolean {
  const m = (membershipType || '').trim().toLowerCase();
  if (!m) return false;
  return !FREE_MEMBERSHIPS.has(m);
}

interface ParsedLine {
  email: string;
  password?: string;
  emailPassword?: string;
  cursorToken?: string;
}

function safeDecrypt(v: string | null | undefined): string {
  if (!v) return '';
  try {
    return isEncrypted(v) ? decryptString(v) : v;
  } catch {
    return '';
  }
}

@Injectable()
export class CursorSubService {
  private readonly logger = new Logger(CursorSubService.name);

  constructor(
    private prisma: PrismaService,
    private warehouse: WarehouseService,
    private usage: CursorUsageService,
    private checkout: CursorCheckoutService,
  ) {}

  // ── 解析：两种导入格式（移植 cursor-jb） ──────────────

  private looksLabeled(line: string): boolean {
    if (LABELED_RE.test(line)) return true;
    if (EMAIL_LABEL_RE.test(line) && /[:：]/.test(line) && /[|｜]/.test(line)) return true;
    return false;
  }

  /** 带标签格式：邮箱：a@b.com | WorkosCursorSessionToken：user_x::eyJ... | access_token：eyJ... */
  private parseLabeled(line: string): ParsedLine | null {
    let email = '';
    let sessionToken = '';
    let accessToken = '';
    for (const field of line.split(/[|｜]/)) {
      const f = field.trim();
      if (!f) continue;
      const idx = f.search(/[:：]/);
      if (idx < 0) continue;
      const key = f.slice(0, idx).trim().toLowerCase();
      const val = f.slice(idx + 1).trim();
      if (!val) continue;
      if (key.includes('邮箱') || key.includes('mail') || key.includes('账号') || key === 'account') {
        email = val;
      } else if (key.includes('sessiontoken') || key.includes('session_token') || key.includes('session token')) {
        sessionToken = val;
      } else if (key.includes('access')) {
        accessToken = val;
      }
    }
    if (!email) return null;
    const token = sessionToken || accessToken;
    if (!token) return null;
    return { email, cursorToken: token };
  }

  /** 分隔符格式：email----emailpwd----cursorpwd----token */
  private parseDelimited(line: string, preferred: string): ParsedLine | null {
    const seps = [preferred, ...COMMON_SEPARATORS.filter((s) => s !== preferred)];
    for (const sep of seps) {
      if (!sep) continue;
      const parts = line.split(sep).map((p) => p.trim());
      if (parts.length >= 2 && parts[0] && parts[0].includes('@')) {
        return {
          email: parts[0],
          emailPassword: parts[1] || undefined,
          password: parts[2] || undefined,
          cursorToken: parts[3] || undefined,
        };
      }
    }
    return null;
  }

  private parseBulk(text: string, separator: string) {
    const items: ParsedLine[] = [];
    const errors: { line: number; raw: string; error: string }[] = [];
    const seen = new Set<string>();
    const lines = text.split(/\r?\n/);
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      let parsed: ParsedLine | null = null;
      if (this.looksLabeled(line)) {
        parsed = this.parseLabeled(line);
        if (!parsed) errors.push({ line: i + 1, raw, error: '带标签格式缺少邮箱或 token' });
      } else {
        parsed = this.parseDelimited(line, separator);
        if (parsed && !parsed.password && !parsed.cursorToken) {
          errors.push({ line: i + 1, raw, error: '缺少 cursor 密码或 token' });
          parsed = null;
        }
        if (!parsed && EMAIL_LABEL_RE.test(line)) parsed = this.parseLabeled(line);
        if (!parsed) errors.push({ line: i + 1, raw, error: '无法解析该行' });
      }
      if (!parsed || !parsed.email) return;
      const emailKey = parsed.email.toLowerCase();
      if (seen.has(emailKey)) {
        errors.push({ line: i + 1, raw, error: `邮箱 ${parsed.email} 本次重复` });
        return;
      }
      seen.add(emailKey);
      items.push(parsed);
    });
    return { items, errors };
  }

  // ── CRUD ──────────────────────────────────────────

  async list(params: { status?: string; keyword?: string; page?: number; pageSize?: number }) {
    // 到期状态刷新（把过期的 subscribed 标为 expired）
    await this.refreshExpiredStatus();

    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));
    const where: Prisma.CursorSubAccountWhereInput = {};
    // 「已订阅」tab 同时包含已过期（都属于"已订阅过"的号），不再单独暴露过期 tab
    if (params.status === 'subscribed') {
      where.status = { in: ['subscribed', 'expired'] };
    } else if (params.status && params.status !== 'all') {
      where.status = params.status;
    }
    if (params.keyword) where.email = { contains: params.keyword.trim() };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.cursorSubAccount.count({ where }),
      this.prisma.cursorSubAccount.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const grouped = await this.prisma.cursorSubAccount.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;
    const counts = {
      unsubscribed: byStatus.unsubscribed ?? 0,
      // 已订阅 tab 计数含过期
      subscribed: (byStatus.subscribed ?? 0) + (byStatus.expired ?? 0),
      unlisted: byStatus.unlisted ?? 0,
    };

    // 关联仓库销售状态（按 warehouseRef）
    const refs = rows.map((r) => r.warehouseRef).filter((x): x is string => !!x);
    const whRows = refs.length
      ? await this.prisma.warehouseAccount.findMany({
          where: { sourceRef: { in: refs } },
          select: { sourceRef: true, status: true, soldAt: true, orderNo: true },
        })
      : [];
    const whMap = new Map(whRows.map((w) => [w.sourceRef!, w]));

    return {
      total,
      page,
      pageSize,
      counts,
      items: rows.map((r) => this.toView(r, r.warehouseRef ? whMap.get(r.warehouseRef) : undefined)),
    };
  }

  async get(id: number) {
    const r = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('账号不存在');
    // 关联仓库销售状态（按 warehouseRef），与 list 保持一致
    const wh = r.warehouseRef
      ? ((await this.prisma.warehouseAccount.findUnique({
          where: { sourceRef: r.warehouseRef },
          select: { status: true, soldAt: true, orderNo: true },
        })) ?? undefined)
      : undefined;
    return this.toView(r, wh);
  }

  async create(dto: CreateCursorSubDto) {
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.cursorSubAccount.findUnique({ where: { email } });
    if (exists) throw new BadRequestException('该邮箱已存在');
    const r = await this.prisma.cursorSubAccount.create({
      data: {
        email,
        passwordEnc: dto.password ? encryptString(dto.password) : null,
        emailPasswordEnc: dto.emailPassword ? encryptString(dto.emailPassword) : null,
        cursorTokenEnc: dto.cursorToken ? encryptString(dto.cursorToken) : null,
        note: dto.note ?? null,
        subscriptionDays: dto.subscriptionDays ?? 30,
        status: 'unsubscribed',
      },
    });
    return this.toView(r);
  }

  async update(id: number, dto: UpdateCursorSubDto) {
    const acc = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    const data: Prisma.CursorSubAccountUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.password !== undefined) data.passwordEnc = dto.password ? encryptString(dto.password) : null;
    if (dto.emailPassword !== undefined) {
      data.emailPasswordEnc = dto.emailPassword ? encryptString(dto.emailPassword) : null;
    }
    if (dto.cursorToken !== undefined) {
      data.cursorTokenEnc = dto.cursorToken ? encryptString(dto.cursorToken) : null;
    }
    if (dto.note !== undefined) data.note = dto.note || null;
    if (dto.subscriptionDays !== undefined) data.subscriptionDays = dto.subscriptionDays;
    const r = await this.prisma.cursorSubAccount.update({ where: { id }, data });
    return this.toView(r);
  }

  async remove(id: number) {
    const acc = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    // 同步删除仓库记录（best-effort，保留 CardKey/订单）
    if (acc.warehouseRef) {
      await this.warehouse.deleteByRef(acc.warehouseRef).catch(() => null);
    }
    await this.prisma.cursorSubAccount.delete({ where: { id } });
    return { ok: true };
  }

  async bulkImport(dto: BulkImportCursorSubDto) {
    const separator = dto.separator || SEPARATOR;
    const days = dto.subscriptionDays ?? 30;
    const { items, errors } = this.parseBulk(dto.text, separator);

    const totalLines = dto.text
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#')).length;

    let created = 0;
    for (const it of items) {
      const email = it.email.trim().toLowerCase();
      const exists = await this.prisma.cursorSubAccount.findUnique({ where: { email } });
      if (exists) {
        errors.push({ line: 0, raw: it.email, error: `邮箱 ${it.email} 已存在` });
        continue;
      }
      await this.prisma.cursorSubAccount.create({
        data: {
          email,
          passwordEnc: it.password ? encryptString(it.password) : null,
          emailPasswordEnc: it.emailPassword ? encryptString(it.emailPassword) : null,
          cursorTokenEnc: it.cursorToken ? encryptString(it.cursorToken) : null,
          subscriptionDays: days,
          status: 'unsubscribed',
        },
      });
      created += 1;
    }
    return { totalLines, created, skipped: errors };
  }

  /** 导出单个账号的明文（email----emailpwd----cursorpwd----token） */
  async export(id: number, separator = SEPARATOR) {
    const acc = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    const emailPwd = safeDecrypt(acc.emailPasswordEnc);
    const password = safeDecrypt(acc.passwordEnc);
    const token = safeDecrypt(acc.cursorTokenEnc);
    return {
      id: acc.id,
      email: acc.email,
      emailPassword: emailPwd,
      password,
      cursorToken: token,
      separator,
      formatted: [acc.email, emailPwd, password, token].join(separator),
    };
  }

  // ── 订阅状态 ────────────────────────────────────────

  /** 手动标记已付款：paidAt=now，expiresAt=now+周期 */
  async markPaid(id: number) {
    const acc = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (acc.subscriptionDays || 30) * 86400 * 1000);
    const r = await this.prisma.cursorSubAccount.update({
      where: { id },
      data: { paidAt: now, expiresAt, status: 'subscribed' },
    });
    return this.toView(r);
  }

  /** 从 Cursor 拉真实账期，覆盖 paidAt/expiresAt */
  async syncSubscription(id: number) {
    const acc = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    const token = safeDecrypt(acc.cursorTokenEnc);
    if (!token) throw new BadRequestException('该账号没有 token，无法同步');
    const r = await this.usage.fetchUsage(token);
    if (!r.success) throw new BadRequestException(r.error || '调用 Cursor 失败');
    const start = r.billingCycleStart ? new Date(r.billingCycleStart) : null;
    const end = r.billingCycleEnd ? new Date(r.billingCycleEnd) : null;
    const now = new Date();
    // 状态推进（不动「已下架」）：
    //   付费订阅（pro 及以上）→ 已订阅；免费 → 未订阅；否则按账期判断
    let status = acc.status;
    if (acc.status !== 'unlisted') {
      if (isPaidMembership(r.membershipType)) {
        status = 'subscribed';
      } else if (r.membershipType) {
        // 明确查到是 free 类
        status = 'unsubscribed';
      } else if (end) {
        status = end > now ? 'subscribed' : 'expired';
      }
    }
    const updated = await this.prisma.cursorSubAccount.update({
      where: { id },
      data: {
        paidAt: start ?? acc.paidAt,
        expiresAt: end ?? acc.expiresAt,
        membershipType: r.membershipType ?? acc.membershipType,
        planUsed: r.planUsed ?? null,
        planLimit: r.planLimit ?? null,
        planPercentUsed: r.planPercentUsed ?? null,
        status,
        lastSyncedAt: now,
      },
    });
    return { ...this.toView(updated), usage: r };
  }

  /** 批量同步订阅状态（并发 5，用于让列表的「订阅」列显示真实类型） */
  async syncMany(ids: number[]) {
    if (!Array.isArray(ids) || !ids.length) throw new BadRequestException('请选择账号');
    if (ids.length > 200) throw new BadRequestException('单次最多同步 200 个');
    let ok = 0;
    const failed: { id: number; error: string }[] = [];
    const concurrency = 5;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          await this.syncSubscription(id);
          ok += 1;
        } catch (e) {
          failed.push({ id, error: (e as Error)?.message || '同步失败' });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return { total: ids.length, ok, failed };
  }

  /**
   * 查用量（不落库，仅返回）。
   * 注意：返回体不能带顶层 success 字段——那是全局响应信封的保留字
   * （TransformInterceptor 会原样透传，前端拦截器会把它当信封解包成 undefined），统一用 ok。
   */
  async fetchUsage(id: number) {
    const acc = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    const token = safeDecrypt(acc.cursorTokenEnc);
    if (!token) return { ok: false, hasToken: false, error: '该账号没有 token' };
    const { success, ...rest } = await this.usage.fetchUsage(token);
    return { ...rest, ok: success, hasToken: true };
  }

  // ── 订阅结账链接 ────────────────────────────────────

  /** 给单个账号生成 Stripe 结账链接（买家自付），并落库缓存 */
  async generateCheckoutLink(id: number) {
    const acc = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    const token = safeDecrypt(acc.cursorTokenEnc);
    if (!token) throw new BadRequestException('该账号没有 token，无法生成结账链接');
    const { url } = await this.checkout.createCheckoutSession(token);
    const updated = await this.prisma.cursorSubAccount.update({
      where: { id },
      data: { lastCheckoutUrl: url, lastCheckoutAt: new Date() },
    });
    return { id: updated.id, email: updated.email, url, at: updated.lastCheckoutAt };
  }

  /** 批量生成：对给定 id（或本页未订阅且有 token 的账号）逐个生成，返回成功/失败明细 */
  async generateCheckoutLinks(ids: number[]) {
    if (!Array.isArray(ids) || !ids.length) throw new BadRequestException('请选择账号');
    if (ids.length > 100) throw new BadRequestException('单次最多 100 个');
    const ok: { id: number; email: string; url: string }[] = [];
    const failed: { id: number; email?: string; error: string }[] = [];
    for (const id of ids) {
      try {
        const r = await this.generateCheckoutLink(id);
        ok.push({ id: r.id, email: r.email, url: r.url });
      } catch (e) {
        const acc = await this.prisma.cursorSubAccount.findUnique({
          where: { id },
          select: { email: true },
        });
        failed.push({ id, email: acc?.email, error: (e as Error)?.message || '生成失败' });
      }
    }
    return { total: ids.length, ok, failed };
  }

  private async refreshExpiredStatus() {
    await this.prisma.cursorSubAccount.updateMany({
      where: { status: 'subscribed', expiresAt: { not: null, lt: new Date() } },
      data: { status: 'expired' },
    });
  }

  // ── 与仓库联动 ──────────────────────────────────────

  private buildContent(acc: {
    email: string;
    emailPasswordEnc: string | null;
    passwordEnc: string | null;
    cursorTokenEnc: string | null;
  }): string {
    return [
      acc.email,
      safeDecrypt(acc.emailPasswordEnc),
      safeDecrypt(acc.passwordEnc),
      safeDecrypt(acc.cursorTokenEnc),
    ].join(SEPARATOR);
  }

  /** 推送到仓库（未分配状态，等 admin 分配到商品上架） */
  async pushToWarehouse(id: number) {
    const acc = await this.prisma.cursorSubAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    const ref = acc.warehouseRef || `cursor-sub:${acc.id}`;
    const r = await this.warehouse.bulkImport([
      {
        sourceRef: ref,
        content: this.buildContent(acc),
        email: acc.email,
        remark: acc.note || undefined,
      },
    ]);
    if (!acc.warehouseRef) {
      await this.prisma.cursorSubAccount.update({
        where: { id },
        data: { warehouseRef: ref },
      });
    }
    return { ok: true, warehouseRef: ref, result: r };
  }

  // ── 迁移：从 cursor-jb 导出的已解密账号导入 ──────────

  async migrateImport(items: MigrateCursorSubItemDto[]) {
    if (!Array.isArray(items) || !items.length) {
      throw new BadRequestException('items 不能为空');
    }
    if (items.length > 5000) throw new BadRequestException('单次最多迁移 5000 条');

    let created = 0;
    let skipped = 0;
    const errors: { email: string; error: string }[] = [];
    for (const it of items) {
      const email = (it.email || '').trim().toLowerCase();
      if (!email) {
        errors.push({ email: it.email || '(空)', error: '邮箱为空' });
        continue;
      }
      const exists = await this.prisma.cursorSubAccount.findUnique({ where: { email } });
      if (exists) {
        skipped += 1;
        continue;
      }
      const warehouseRef = it.oldId ? `cursor-jb:${it.oldId}` : null;
      try {
        await this.prisma.cursorSubAccount.create({
          data: {
            email,
            passwordEnc: it.password ? encryptString(it.password) : null,
            emailPasswordEnc: it.emailPassword ? encryptString(it.emailPassword) : null,
            cursorTokenEnc: it.cursorToken ? encryptString(it.cursorToken) : null,
            note: it.note ?? null,
            status: it.status || 'unsubscribed',
            paidAt: it.paidAt ? new Date(it.paidAt) : null,
            expiresAt: it.expiresAt ? new Date(it.expiresAt) : null,
            subscriptionDays: it.subscriptionDays ?? 30,
            warehouseRef,
          },
        });
        created += 1;
      } catch (e) {
        errors.push({ email, error: (e as Error)?.message || String(e) });
      }
    }
    return { total: items.length, created, skipped, errors };
  }

  private toView(r: any, wh?: { status: string; soldAt: Date | null; orderNo: string | null }) {
    return {
      id: r.id,
      email: r.email,
      hasPassword: !!r.passwordEnc,
      hasEmailPassword: !!r.emailPasswordEnc,
      hasCursorToken: !!r.cursorTokenEnc,
      note: r.note,
      status: r.status,
      membershipType: r.membershipType ?? null,
      planUsed: r.planUsed ?? null,
      planLimit: r.planLimit ?? null,
      planPercentUsed: r.planPercentUsed ?? null,
      paidAt: r.paidAt,
      expiresAt: r.expiresAt,
      subscriptionDays: r.subscriptionDays,
      warehouseRef: r.warehouseRef,
      lastSyncedAt: r.lastSyncedAt,
      lastCheckoutUrl: r.lastCheckoutUrl,
      lastCheckoutAt: r.lastCheckoutAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      // 仓库销售状态（未推送则 null）
      saleStatus: wh?.status ?? null,
      soldAt: wh?.soldAt ?? null,
      orderNo: wh?.orderNo ?? null,
    };
  }
}
