import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import dayjs from 'dayjs';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptString, encryptString, isEncrypted, maskSecret } from '../../common/crypto.util';

const ASSIGNABLE_POOL_STATUSES = ['HEALTHY', 'LOW_QUOTA', 'UNKNOWN'];
const DEFAULT_POOL_QUOTA_PER_CNY = 1;
const DEFAULT_POOL_VALIDITY_DAYS = 30;
const POOL_ACCOUNT_SEPARATOR = '----';
const CURSOR_USAGE_SUMMARY_URL = 'https://cursor.com/api/usage-summary';
const CURSOR_USAGE_EVENTS_URL = 'https://cursor.com/api/dashboard/get-filtered-usage-events';

function toFixed4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function numeric(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumberFrom(keys: string[], source: any): number | null {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    const n = Number(source[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function envNumber(key: string, fallback: number) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseMoneyLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const n = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cursorDateMs(value: Date | null | undefined) {
  if (!value) return null;
  const ms = value.getTime();
  return Number.isFinite(ms) ? String(ms) : null;
}

@Injectable()
export class PoolService {
  private readonly logger = new Logger(PoolService.name);

  constructor(private prisma: PrismaService) {
    // 启动时延迟执行一次明文 → 密文迁移
    setTimeout(() => {
      this.migrateEncryptAllTokens().catch((e) => {
        this.logger.error(`migrateEncryptAllTokens failed: ${e?.message ?? e}`);
      });
    }, 2000);
  }

  private quotaRemain(total: unknown, used: unknown) {
    return Math.max(0, toFixed4(numeric(total) - numeric(used)));
  }

  private safeDecrypt(token?: string | null) {
    if (!token) return '';
    try {
      return decryptString(token);
    } catch {
      return '';
    }
  }

  private parsePoolCredential(raw: string) {
    const value = String(raw || '').trim();
    const parts = value.split(POOL_ACCOUNT_SEPARATOR).map((part) => part.trim());
    if (parts.length >= 4) {
      return {
        raw: value,
        email: parts[0] || '',
        emailPassword: parts[1] || '',
        cursorPassword: parts[2] || '',
        cursorToken: parts.slice(3).join(POOL_ACCOUNT_SEPARATOR).trim(),
      };
    }
    return {
      raw: value,
      email: '',
      emailPassword: '',
      cursorPassword: '',
      cursorToken: value,
    };
  }

  private cursorAuthHeaders(cursorToken: string, includeOrigin = false) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Cookie: `WorkosCursorSessionToken=${cursorToken}`,
      Authorization: `Bearer ${cursorToken}`,
      Referer: 'https://cursor.com/dashboard/usage',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    };
    if (includeOrigin) headers.Origin = 'https://cursor.com';
    return headers;
  }

  private getPath(source: any, path: string) {
    return path.split('.').reduce((current, key) => {
      if (current == null) return undefined;
      return current[key];
    }, source);
  }

  private firstMoney(source: any, paths: string[]) {
    for (const path of paths) {
      const n = parseMoneyLike(this.getPath(source, path));
      if (n !== null) return /cents?/i.test(path) ? n / 100 : n;
    }
    return null;
  }

  private firstDate(source: any, paths: string[]) {
    for (const path of paths) {
      const value = this.getPath(source, path);
      if (!value) continue;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  private findMoneyByKey(
    source: unknown,
    matcher: (key: string) => boolean,
    seen = new WeakSet<object>(),
  ): number | null {
    if (!source || typeof source !== 'object') return null;
    const obj = source as Record<string, unknown>;
    if (seen.has(obj)) return null;
    seen.add(obj);

    if (Array.isArray(source)) {
      for (const item of source) {
        const n = this.findMoneyByKey(item, matcher, seen);
        if (n !== null) return n;
      }
      return null;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (matcher(key)) {
        const n = parseMoneyLike(value);
        if (n !== null) return /cents?/i.test(key) ? n / 100 : n;
      }
      const nested = this.findMoneyByKey(value, matcher, seen);
      if (nested !== null) return nested;
    }
    return null;
  }

  private cursorBillingWindow(summary: any) {
    const endAt =
      this.firstDate(summary, [
        'billingCycleEnd',
        'currentPeriodEnd',
        'periodEnd',
        'endDate',
        'data.billingCycleEnd',
        'data.currentPeriodEnd',
        'data.periodEnd',
      ]) ?? new Date();
    const startAt =
      this.firstDate(summary, [
        'billingCycleStart',
        'currentPeriodStart',
        'periodStart',
        'startDate',
        'data.billingCycleStart',
        'data.currentPeriodStart',
        'data.periodStart',
      ]) ?? dayjs(endAt).subtract(31, 'day').toDate();
    return { startAt, endAt };
  }

  private normalizeCursorEvents(data: any): any[] {
    const candidates = [
      data,
      data?.events,
      data?.usageEvents,
      data?.items,
      data?.rows,
      data?.data,
      data?.data?.events,
      data?.data?.usageEvents,
      data?.data?.items,
      data?.data?.rows,
      data?.result?.events,
      data?.result?.items,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  private cursorEventCost(event: any) {
    return (
      this.firstMoney(event, [
        'chargedCents',
        'costCents',
        'amountCents',
        'usageCents',
        'priceCents',
        'totalCents',
        'usageCostCents',
        'costInCents',
        'amountInCents',
        'charged',
        'cost',
        'amount',
        'price',
        'usageCost',
        'totalCost',
        'spend',
        'spent',
      ]) ??
      this.findMoneyByKey(event, (key) =>
        /(?:cost|amount|price|charge|charged|spend|spent|cents?|usd|dollars?)/i.test(key),
      ) ??
      0
    );
  }

  private parseCursorSummary(summary: any, fallbackTotal = 0) {
    const used =
      this.firstMoney(summary, [
        'used',
        'usedQuota',
        'usage',
        'usageAmount',
        'usageCost',
        'totalUsed',
        'totalUsage',
        'totalCost',
        'currentUsage',
        'currentSpend',
        'spend',
        'spent',
        'amount',
        'charged',
        'usedCents',
        'usageCents',
        'totalCostCents',
        'data.used',
        'data.usedQuota',
        'data.usage',
        'data.usageCost',
        'data.totalCost',
        'data.currentUsage',
        'data.currentSpend',
        'data.usedCents',
        'data.usageCents',
      ]) ??
      this.findMoneyByKey(
        summary,
        (key) =>
          /(?:used|spend|spent|cost|charged|amount)/i.test(key) &&
          !/(limit|quota|budget|allowance|remaining|remain)/i.test(key),
      ) ??
      0;

    const remain = this.firstMoney(summary, [
      'remain',
      'remaining',
      'quotaRemain',
      'remainingQuota',
      'remainingAmount',
      'remainingCents',
      'data.remain',
      'data.remaining',
      'data.quotaRemain',
      'data.remainingQuota',
      'data.remainingCents',
    ]);

    const detectedTotal =
      this.firstMoney(summary, [
        'total',
        'totalQuota',
        'quotaTotal',
        'limit',
        'quota',
        'budget',
        'allowance',
        'hardLimit',
        'spendingLimit',
        'monthlyLimit',
        'totalCents',
        'limitCents',
        'quotaCents',
        'budgetCents',
        'allowanceCents',
        'hardLimitCents',
        'spendingLimitCents',
        'monthlyLimitCents',
        'data.total',
        'data.totalQuota',
        'data.quotaTotal',
        'data.limit',
        'data.quota',
        'data.budget',
        'data.allowance',
        'data.hardLimit',
        'data.spendingLimit',
        'data.monthlyLimit',
        'data.totalCents',
        'data.limitCents',
        'data.quotaCents',
        'data.budgetCents',
        'data.allowanceCents',
      ]) ??
      this.findMoneyByKey(
        summary,
        (key) =>
          /(?:limit|quota|budget|allowance|total)/i.test(key) &&
          !/(used|usage|spend|spent|cost|charged|amount)/i.test(key),
      );

    const total =
      detectedTotal && detectedTotal > 0
        ? detectedTotal
        : remain !== null
          ? used + remain
          : fallbackTotal;

    return { total: Math.max(0, total), used: Math.max(0, used) };
  }

  private async fetchCursorUsageEvents(cursorToken: string, startAt: Date, endAt: Date) {
    const url = process.env.CURSOR_USAGE_EVENTS_ENDPOINT || CURSOR_USAGE_EVENTS_URL;
    const pageSize = Math.floor(envNumber('CURSOR_USAGE_EVENTS_PAGE_SIZE', 500));
    const maxPages = Math.floor(envNumber('CURSOR_USAGE_EVENTS_MAX_PAGES', 10));
    const startDate = cursorDateMs(startAt);
    const endDate = cursorDateMs(endAt);
    let totalCents = 0;
    let eventCount = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const body: Record<string, string | number> = { page, pageSize };
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;

      const { data } = await axios.post(
        url,
        body,
        {
          headers: this.cursorAuthHeaders(cursorToken, true),
          timeout: envNumber('CURSOR_USAGE_TIMEOUT_MS', 15000),
        },
      );

      const events = Array.isArray(data?.usageEventsDisplay) ? data.usageEventsDisplay : [];
      const totalCount = Number(data?.totalUsageEventsCount || 0);
      for (const event of events) {
        const cents = parseMoneyLike(event?.chargedCents);
        if (cents) totalCents += cents;
        eventCount += 1;
      }

      if (events.length < pageSize) break;
      if (page === maxPages && eventCount < totalCount) {
        this.logger.warn(
          `Cursor usage events truncated: fetched=${eventCount}, total=${totalCount}`,
        );
      }
    }

    return Math.max(0, toFixed4(totalCents / 100));
  }

  private async fetchCursorUsageForWindow(rawToken: string, startAt: Date, endAt: Date) {
    const credential = this.parsePoolCredential(rawToken);
    if (!credential.cursorToken) throw new BadRequestException('Cursor token 为空');
    return this.fetchCursorUsageEvents(credential.cursorToken, startAt, endAt);
  }

  private usageStatus(info: { total: number; used: number; remain: number }) {
    if (info.total > 0) {
      if (info.remain <= 0) return 'EXHAUSTED';
      if (info.remain < 5) return 'LOW_QUOTA';
    }
    return 'HEALTHY';
  }

  private toAccountView(a: any, revealToken = false) {
    const plain = this.safeDecrypt(a.token);
    const credential = this.parsePoolCredential(plain);
    const view: any = {
      id: a.id,
      label: a.label,
      type: a.type,
      email: a.email || credential.email,
      tokenMasked: maskSecret(credential.cursorToken),
      totalQuota: Number(a.totalQuota ?? 0),
      usedQuota: Number(a.usedQuota ?? 0),
      quotaRemain: this.quotaRemain(a.totalQuota, a.usedQuota),
      status: a.status,
      lastCheckAt: a.lastCheckAt,
      note: a.note,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
    if (revealToken) {
      view.token = credential.cursorToken;
      view.cursorPassword = credential.cursorPassword;
      view.emailPassword = credential.emailPassword;
      view.raw = credential.raw;
    }
    return view;
  }

  /** 列表项展示用：脱敏 + 不返回密文 */
  private toListItem(a: any) {
    const activeGrant = Array.isArray(a.grants) ? a.grants[0] : null;
    return {
      ...this.toAccountView(a, false),
      activeGrant: activeGrant
        ? {
            orderNo: activeGrant.orderNo,
            quotaTotal: Number(activeGrant.quotaTotal ?? 0),
            quotaUsed: Number(activeGrant.quotaUsed ?? 0),
            quotaRemain: this.quotaRemain(activeGrant.quotaTotal, activeGrant.quotaUsed),
            endAt: activeGrant.endAt,
          }
        : null,
    };
  }

  private toGrantView(grant: any, revealToken = false) {
    const quotaTotal = Number(grant.quotaTotal ?? 0);
    const quotaUsed = Number(grant.quotaUsed ?? 0);
    return {
      id: grant.id,
      orderNo: grant.orderNo,
      quotaTotal,
      quotaUsed,
      quotaRemain: this.quotaRemain(quotaTotal, quotaUsed),
      validityDays: grant.validityDays,
      startAt: grant.startAt,
      endAt: grant.endAt,
      active: grant.active,
      lastCheckAt: grant.lastCheckAt,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
      account: grant.account ? this.toAccountView(grant.account, revealToken) : null,
    };
  }

  // ====== 账号池（管理员侧） ======

  async listAccounts(page = 1, pageSize = 30) {
    const [total, raw] = await this.prisma.$transaction([
      this.prisma.poolAccount.count(),
      this.prisma.poolAccount.findMany({
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          grants: {
            where: { active: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);
    return { total, page, pageSize, items: raw.map((a) => this.toListItem(a)) };
  }

  /** 单独 reveal 接口：返回明文 token（仅 ADMIN，会写日志） */
  async revealToken(id: number, operator: { id?: number; username?: string }) {
    const a = await this.prisma.poolAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('账号不存在');
    let token = '';
    try {
      token = decryptString(a.token);
    } catch {
      throw new ForbiddenException('解密失败：密钥不正确或密文损坏');
    }
    this.logger.warn(
      `[AUDIT] reveal pool token id=${id} label=${a.label} by user=${operator.username ?? operator.id ?? 'unknown'}`,
    );
    return { id: a.id, label: a.label, token };
  }

  /** 允许 ADMIN 编辑的字段白名单（防止透传 createdAt / id / 内部字段） */
  private pickAccountFields(data: any) {
    const out: any = {};
    if (typeof data?.label === 'string') out.label = data.label.slice(0, 64);
    if (typeof data?.type === 'string') out.type = data.type.slice(0, 32);
    if (typeof data?.email === 'string') out.email = data.email.slice(0, 128);
    if (Number.isFinite(Number(data?.usedQuota))) out.usedQuota = Number(data.usedQuota);
    if (typeof data?.status === 'string') out.status = data.status.slice(0, 16);
    if (typeof data?.note === 'string') out.note = data.note.slice(0, 500);
    return out;
  }

  async createAccount(data: any) {
    const { token } = data;
    if (!token) throw new NotFoundException('token 不能为空');
    if (typeof token !== 'string' || token.length > 10_000) {
      throw new NotFoundException('token 非法或过长');
    }
    const safe = this.pickAccountFields(data);
    const credential = this.parsePoolCredential(token);
    if (!safe.email && credential.email) safe.email = credential.email;
    return this.prisma.poolAccount
      .create({ data: { ...safe, token: encryptString(token) } })
      .then((a) => this.toListItem(a));
  }

  async updateAccount(id: number, data: any) {
    const { token } = data;
    const patch: any = this.pickAccountFields(data);
    if (token !== undefined && token !== null && token !== '') {
      if (typeof token !== 'string' || token.length > 10_000) {
        throw new NotFoundException('token 非法或过长');
      }
      const credential = this.parsePoolCredential(token);
      if (!patch.email && credential.email) patch.email = credential.email;
      patch.token = encryptString(token);
    }
    return this.prisma.poolAccount
      .update({ where: { id }, data: patch })
      .then((a) => this.toListItem(a));
  }

  removeAccount(id: number) {
    return this.prisma.poolAccount.delete({ where: { id } });
  }

  /** 用脚本/启动时把历史明文 token 一次性加密（迁移用） */
  async migrateEncryptAllTokens() {
    const all = await this.prisma.poolAccount.findMany();
    let count = 0;
    for (const a of all) {
      if (!isEncrypted(a.token)) {
        await this.prisma.poolAccount.update({
          where: { id: a.id },
          data: { token: encryptString(a.token) },
        });
        count++;
      }
    }
    if (count) this.logger.warn(`migrated ${count} pool tokens to encrypted form`);
    return { migrated: count };
  }

  // ====== 额度发放（用户侧） ======

  private deriveGrantMeta(order: any) {
    const attrs = order.sku?.attrs;
    const amountRate = envNumber('POOL_QUOTA_PER_CNY', DEFAULT_POOL_QUOTA_PER_CNY);
    const validityDays =
      positiveNumberFrom(['poolValidityDays', 'validityDays'], attrs) ??
      envNumber('POOL_DEFAULT_VALIDITY_DAYS', DEFAULT_POOL_VALIDITY_DAYS);

    const quotaTotal = Number(order.payAmount ?? order.totalAmount) * amountRate;

    return {
      quotaTotal: Math.max(0.0001, toFixed4(quotaTotal)),
      validityDays: Math.max(1, Math.floor(validityDays)),
    };
  }

  /** 本地 POOL_QUOTA 商品付款后创建额度包。重复调用保持幂等。 */
  async createGrantForOrder(orderNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: { product: true, sku: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.product.deliveryType !== 'POOL_QUOTA') return null;
    if (!order.userId) throw new BadRequestException('号池额度包需要登录购买');
    if (!['PAID', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException('订单未支付，暂不能发放号池额度');
    }

    const existing = await this.prisma.poolGrant.findUnique({
      where: { orderNo },
      include: { account: true },
    });
    if (existing) return this.toGrantView(existing, false);

    const { quotaTotal, validityDays } = this.deriveGrantMeta(order);
    const grant = await this.prisma.poolGrant.create({
      data: {
        orderNo,
        quotaTotal: new Prisma.Decimal(quotaTotal),
        validityDays,
        active: true,
      },
      include: { account: true },
    });
    return this.toGrantView(grant, false);
  }

  /** 用户提交自己的 Cursor Token，绑定到订单上（保留旧模式） */
  async bindUserToken(orderNo: string, userToken: string) {
    const grant = await this.prisma.poolGrant.findUnique({ where: { orderNo } });
    if (!grant) throw new NotFoundException('未找到该订单的额度配额');
    return this.prisma.poolGrant.update({
      where: { orderNo },
      data: {
        userToken,
        startAt: grant.startAt ?? new Date(),
        endAt: grant.endAt ?? dayjs().add(grant.validityDays, 'day').toDate(),
        active: true,
      },
    });
  }

  private async deactivateGrant(id: number) {
    return this.prisma.poolGrant.update({
      where: { id },
      data: { active: false, lastCheckAt: new Date() },
      include: { account: true },
    });
  }

  private assertGrantUsable(grant: any) {
    if (grant.endAt && grant.endAt.getTime() < Date.now()) {
      throw new BadRequestException('额度已过期');
    }
    if (this.quotaRemain(grant.quotaTotal, grant.quotaUsed) <= 0) {
      throw new BadRequestException('额度已用完');
    }
    if (!grant.active) {
      throw new BadRequestException('额度已停用');
    }
  }

  /** 查询某个订单的额度使用情况（会顺手刷新已分配账号的最新用量） */
  async queryQuota(orderNo: string) {
    const current = await this.prisma.poolGrant.findUnique({
      where: { orderNo },
      include: { account: true },
    });
    if (!current) throw new NotFoundException('订单无效');

    if (current.accountId) {
      await this.syncAccountUsage(current.accountId).catch((e) => {
        this.logger.warn(`sync grant account ${current.accountId} failed: ${e.message}`);
      });
    }

    let grant = await this.prisma.poolGrant.findUnique({
      where: { orderNo },
      include: { account: true },
    });
    if (!grant) throw new NotFoundException('订单无效');

    const expired = !!grant.endAt && grant.endAt.getTime() < Date.now();
    const exhausted = this.quotaRemain(grant.quotaTotal, grant.quotaUsed) <= 0;
    if (grant.active && (expired || exhausted)) {
      grant = await this.deactivateGrant(grant.id);
    }

    return this.toGrantView(grant, false);
  }

  /** 用户从号池申请账号；已申请过则幂等返回同一个账号的明文 token。 */
  async claimAccount(orderNo: string) {
    let grant = await this.prisma.poolGrant.findUnique({
      where: { orderNo },
      include: { account: true },
    });
    if (!grant) throw new NotFoundException('未找到该订单的额度配额');

    if (grant.accountId) {
      await this.syncAccountUsage(grant.accountId).catch((e) => {
        this.logger.warn(`sync claimed account ${grant.accountId} failed: ${e.message}`);
      });
      grant = await this.prisma.poolGrant.findUnique({
        where: { orderNo },
        include: { account: true },
      });
      this.assertGrantUsable(grant);
      return this.toGrantView(grant, true);
    }

    this.assertGrantUsable(grant);
    const candidates = await this.prisma.poolAccount.findMany({
      where: {
        status: { in: ASSIGNABLE_POOL_STATUSES as any },
        grants: { none: { active: true } },
      },
      orderBy: { id: 'asc' },
      take: 50,
    });

    for (const account of candidates) {
      const synced = await this.syncAccountUsage(account.id, { applyGrantUsage: false }).catch((e) => {
        this.logger.warn(`skip pool account ${account.id}: ${e.message}`);
        return null;
      });
      if (!synced) continue;

      const assigned = await this.prisma.$transaction(async (tx) => {
        const freshGrant = await tx.poolGrant.findUnique({ where: { id: grant.id } });
        if (!freshGrant) throw new NotFoundException('未找到该订单的额度配额');
        if (freshGrant.accountId) {
          return tx.poolGrant.findUnique({
            where: { id: freshGrant.id },
            include: { account: true },
          });
        }
        const activeCount = await tx.poolGrant.count({
          where: { accountId: account.id, active: true },
        });
        if (activeCount > 0) return null;

        const now = new Date();
        return tx.poolGrant.update({
          where: { id: freshGrant.id },
          data: {
            accountId: account.id,
            startAt: freshGrant.startAt ?? now,
            endAt: freshGrant.endAt ?? dayjs(now).add(freshGrant.validityDays, 'day').toDate(),
            active: true,
            lastCheckAt: now,
          },
          include: { account: true },
        });
      });

      if (assigned) return this.toGrantView(assigned, true);
    }

    throw new BadRequestException('暂无满足该额度的可用号池账号，请稍后再试或联系管理员');
  }

  /**
   * 刷新单个池账号用量。
   * applyGrantUsage=true 时，会把账号 usedQuota 相比上次快照的增量扣到当前活跃 Grant。
   */
  private async syncAccountUsage(
    accountId: number,
    options: { applyGrantUsage?: boolean } = {},
  ) {
    const applyGrantUsage = options.applyGrantUsage !== false;
    const account = await this.prisma.poolAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('账号不存在');

    const plainToken = decryptString(account.token);
    const checkedAt = new Date();
    const info = await this.fetchCursorUsage(plainToken, Number(account.totalQuota ?? 0));
    info.total = toFixed4(Number(info.total || 0));
    info.used = toFixed4(Number(info.used || 0));
    info.remain = toFixed4(Math.max(0, Number(info.remain ?? info.total - info.used)));

    const activeGrant = applyGrantUsage
      ? await this.prisma.poolGrant.findFirst({
          where: { accountId: account.id, active: true },
          orderBy: { createdAt: 'asc' },
        })
      : null;
    const grantWindowUsed = activeGrant
      ? await this.fetchCursorUsageForWindow(
          plainToken,
          activeGrant.startAt ?? activeGrant.createdAt ?? checkedAt,
          checkedAt,
        ).catch((e) => {
          this.logger.warn(`fetch grant usage window failed: ${e?.message ?? e}`);
          return null;
        })
      : null;
    let grantDelta = 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.poolAccount.update({
        where: { id: account.id },
        data: {
          totalQuota: new Prisma.Decimal(info.total),
          usedQuota: new Prisma.Decimal(info.used),
          status: this.usageStatus(info) as any,
          lastCheckAt: checkedAt,
        },
      });

      if (!activeGrant) return;

      const expired = !!activeGrant.endAt && activeGrant.endAt.getTime() < Date.now();
      const previousGrantUsed = Number(activeGrant.quotaUsed ?? 0);
      const nextUsed =
        grantWindowUsed === null
          ? previousGrantUsed
          : toFixed4(Math.max(0, grantWindowUsed));
      const exhausted = nextUsed >= Number(activeGrant.quotaTotal) - 0.0001;
      grantDelta = expired ? 0 : Math.max(0, toFixed4(nextUsed - previousGrantUsed));

      await tx.poolGrant.update({
        where: { id: activeGrant.id },
        data: {
          quotaUsed: new Prisma.Decimal(nextUsed),
          active: !(expired || exhausted),
          lastCheckAt: checkedAt,
        },
      });
    });

    return { id: account.id, info, delta: grantDelta };
  }

  /** 对所有 Pool 账号执行查询，并把用量增量同步到活跃额度 */
  async refreshAllAccounts() {
    const accounts = await this.prisma.poolAccount.findMany();
    const results: any[] = [];
    for (const a of accounts) {
      try {
        const synced = await this.syncAccountUsage(a.id);
        results.push({ id: a.id, ok: true, ...synced.info, grantDelta: synced.delta });
      } catch (e: any) {
        await this.prisma.poolAccount.update({
          where: { id: a.id },
          data: { status: 'UNKNOWN', lastCheckAt: new Date() },
        });
        results.push({ id: a.id, ok: false, error: e.message });
      }
    }
    return results;
  }

  /**
   * 查询 Cursor 实际用量。
   * 默认读取 Cursor usage-summary 和 get-filtered-usage-events。
   */
  private async fetchCursorUsage(
    rawToken: string,
    fallbackTotal = 0,
  ): Promise<{ total: number; used: number; remain: number }> {
    const credential = this.parsePoolCredential(rawToken);
    if (!credential.cursorToken) throw new BadRequestException('Cursor token 为空');

    const summaryUrl = process.env.CURSOR_USAGE_SUMMARY_ENDPOINT || CURSOR_USAGE_SUMMARY_URL;
    const { data: summary } = await axios.get(summaryUrl, {
      headers: this.cursorAuthHeaders(credential.cursorToken),
      timeout: envNumber('CURSOR_USAGE_TIMEOUT_MS', 15000),
    });

    const { startAt, endAt } = this.cursorBillingWindow(summary);
    const parsed = this.parseCursorSummary(summary, fallbackTotal);
    const eventUsed = await this.fetchCursorUsageEvents(credential.cursorToken, startAt, endAt).catch(
      (e) => {
        this.logger.warn(`fetch Cursor usage events failed: ${e?.message ?? e}`);
        return null;
      },
    );

    const total = toFixed4(fallbackTotal > 0 ? fallbackTotal : 0);
    const used = toFixed4(eventUsed ?? parsed.used);
    return {
      total,
      used,
      remain: total > 0 ? toFixed4(Math.max(0, total - used)) : 0,
    };
  }

  /** 一键激活：把用户的 Token 提交到外部激活服务（占位实现） */
  async activateUserToken(token: string, captcha?: string) {
    const endpoint = process.env.CURSOR_ACTIVATE_ENDPOINT;
    if (!endpoint) {
      // 本地 mock：直接返回成功
      await new Promise((r) => setTimeout(r, 800));
      return { ok: true, message: '激活成功（mock）', plan: 'ultra' };
    }
    const { data } = await axios.post(
      endpoint,
      { token, captcha },
      { timeout: 30000 },
    );
    return data;
  }
}
