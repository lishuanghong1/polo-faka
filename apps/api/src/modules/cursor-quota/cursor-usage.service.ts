import { Injectable, Logger } from '@nestjs/common';

/**
 * Cursor 额度查询服务。
 * 计费口径完整移植自 polo_faka/quota-check-clone/server.mjs：
 *  - /api/usage-summary   会员、账期、plan used/limit/percent（美分）
 *  - /api/auth/me         账户邮箱 / 名称
 *  - /api/dashboard/get-filtered-usage-events  账期逐条用量（分页）
 * 金额内部一律以「美分」计，只有展示字段转成美元文本。
 */

const CURSOR_ORIGIN = 'https://cursor.com';
const CURSOR_USAGE_URL =
  process.env.CURSOR_USAGE_SUMMARY_ENDPOINT || 'https://cursor.com/api/usage-summary';
const CURSOR_ME_URL = process.env.CURSOR_ME_ENDPOINT || 'https://cursor.com/api/auth/me';
const CURSOR_EVENTS_URL =
  process.env.CURSOR_USAGE_EVENTS_ENDPOINT ||
  'https://cursor.com/api/dashboard/get-filtered-usage-events';
const DEFAULT_TIMEOUT_MS = 15_000;
const EVENT_PAGE_SIZE = 500;
const MAX_EVENT_PAGES = 20;

const WORKOS_TOKEN_PATTERN =
  /^user_[A-Za-z0-9_-]+::[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** 带 HTTP 状态码的可控业务错误。 */
export class QuotaCheckError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'QuotaCheckError';
    this.statusCode = statusCode;
  }
}

export interface QuotaReport {
  success: true;
  email: string;
  name: string;
  membershipType: string;
  isUnlimited: boolean;
  billingCycle: { startDateEpochMillis: string; endDateEpochMillis: string };
  includedAmountCents: number;
  includedAmountUsd: string;
  includedLimitCents: number;
  includedLimitUsd: string;
  totalCostCents: number;
  totalCostUsd: string;
  totalRequests: number;
  totalTokens: number;
  includedCostCents: number;
  includedCostUsd: string;
  includedCount: number;
  onDemandCostCents: number;
  onDemandCostUsd: string;
  onDemandCount: number;
  onDemandTokens: number;
  apiPercentUsed: number;
  autoPercentUsed: number;
  totalPercentUsed: number;
  includedBreakdown: {
    api: { costCents: number; costUsd: string; percentUsed: number; tokens: number };
    auto: { costCents: number; costUsd: string; percentUsed: number; tokens: number };
  };
  modelBreakdown: Record<string, { costCents: number; tokens: number; requests: number }>;
  planInfo: {
    planName: string;
    includedAmountCents: number;
    price: string;
    billingCycleEnd: string;
  };
  events: NormalizedEvent[];
  eventsTruncated: boolean;
  upstreamEventCount: number;
  queriedAt: string;
}

interface NormalizedEvent {
  timestamp: number;
  model: string;
  kind: string;
  isOnDemand: boolean;
  typeName: string;
  tokens: number;
  meteredTokens: number;
  costCents: number;
  costUsd: string;
}

/** 归一化 Token：兼容完整 Cookie / URL 编码的 ::，并校验 WorkosCursorSessionToken 格式。 */
export function normalizeToken(raw: unknown): string {
  if (typeof raw !== 'string') throw new QuotaCheckError('请提供 Cursor Token');
  let token = raw.trim();
  const cookieMatch = token.match(/(?:^|;\s*)WorkosCursorSessionToken=([^;]+)/i);
  if (cookieMatch) token = cookieMatch[1].trim();
  token = token.replace(/%3A%3A/gi, '::');

  if (!token) throw new QuotaCheckError('请提供 Cursor Token');
  if (token.length > 8192) throw new QuotaCheckError('Token 长度异常');
  if (/[\r\n;]/.test(token)) throw new QuotaCheckError('Token 包含非法字符');
  if (!WORKOS_TOKEN_PATTERN.test(token)) {
    throw new QuotaCheckError('Token 格式不正确，请提供 WorkosCursorSessionToken');
  }
  return token;
}

function toFiniteNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  let candidate: any = value;
  if (typeof value === 'string' && /^\d+$/.test(value)) candidate = Number(value);
  if (typeof candidate === 'number' && candidate < 10_000_000_000) candidate *= 1000;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toEpochMillis(value: any): number | null {
  const iso = toIsoDate(value);
  return iso ? new Date(iso).getTime() : null;
}

function formatUsd(cents: any, digits = 2): string {
  const value = toFiniteNumber(cents) ?? 0;
  return `$${(value / 100).toFixed(digits)}`;
}

/** 单次事件总 Tokens：优先 totalTokens，否则四类相加。 */
function eventTokenTotal(event: any): number {
  const usage = event?.tokenUsage;
  if (!usage || typeof usage !== 'object') return 0;
  const direct = toFiniteNumber(usage.totalTokens);
  if (direct !== null) return Math.max(0, direct);
  return ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens']
    .map((k) => toFiniteNumber(usage[k]) ?? 0)
    .reduce((s, v) => s + v, 0);
}

/** API 卡口径 Tokens：输入 + 输出 + 缓存读取，不含缓存写入。 */
function eventMeteredTokenTotal(event: any): number {
  const usage = event?.tokenUsage;
  if (!usage || typeof usage !== 'object') return 0;
  return ['inputTokens', 'outputTokens', 'cacheReadTokens']
    .map((k) => toFiniteNumber(usage[k]) ?? 0)
    .reduce((s, v) => s + v, 0);
}

function eventCostCents(event: any): number {
  return Math.max(
    0,
    toFiniteNumber(event?.tokenUsage?.totalCents) ?? toFiniteNumber(event?.chargedCents) ?? 0,
  );
}

function isReportableEvent(event: any): boolean {
  return Boolean(event && typeof event === 'object' && event.timestamp);
}

/** INCLUDED_IN_* 事件属于套餐内。 */
function isIncludedEvent(event: any): boolean {
  return /^USAGE_EVENT_KIND_INCLUDED_IN_/i.test(String(event?.kind || ''));
}

/** Auto / Composer 事件单独归类。 */
function isAutoEvent(event: any): boolean {
  const marker = `${event?.model || ''} ${event?.kind || ''}`.toLowerCase();
  return marker.includes('auto') || marker.includes('composer');
}

function normalizeEvent(event: any): NormalizedEvent {
  const timestamp = toFiniteNumber(event?.timestamp) ?? 0;
  const included = isIncludedEvent(event);
  const costCents = eventCostCents(event);
  return {
    timestamp,
    model: String(event?.model || 'unknown'),
    kind: String(event?.kind || 'unknown'),
    isOnDemand: !included,
    typeName: included ? '套餐内' : '超额',
    tokens: eventTokenTotal(event),
    meteredTokens: eventMeteredTokenTotal(event),
    costCents,
    costUsd: formatUsd(costCents, 4),
  };
}

/** 摘要字段裁剪。 */
export function normalizeUsageSummary(input: any) {
  const data = input && typeof input === 'object' ? input : {};
  const individual =
    data.individualUsage && typeof data.individualUsage === 'object' ? data.individualUsage : {};
  return {
    membershipType: typeof data.membershipType === 'string' ? data.membershipType : null,
    billingCycleStart: toIsoDate(data.billingCycleStart),
    billingCycleEnd: toIsoDate(data.billingCycleEnd),
    isUnlimited: Boolean(data.isUnlimited),
    plan: individual.plan ?? {},
  };
}

@Injectable()
export class CursorUsageService {
  private readonly logger = new Logger(CursorUsageService.name);

  private headers(token: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: `WorkosCursorSessionToken=${encodeURIComponent(token)}`,
      Origin: CURSOR_ORIGIN,
      Referer: `${CURSOR_ORIGIN}/dashboard/usage`,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    };
  }

  private async fetchJson(
    url: string,
    token: string,
    signal: AbortSignal,
    method: 'GET' | 'POST' = 'GET',
    body?: any,
  ): Promise<any> {
    const response = await fetch(url, {
      method,
      redirect: 'error',
      signal,
      headers: this.headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 || response.status === 403) {
      throw new QuotaCheckError('Token 已失效或无权查询', 401);
    }
    if (!response.ok) {
      throw new QuotaCheckError(`Cursor 服务暂时不可用（HTTP ${response.status}）`, 502);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new QuotaCheckError('Cursor 返回了无法识别的数据', 502);
    }
  }

  /** 按账期分页拉全量事件，最多 MAX_EVENT_PAGES 页。 */
  private async fetchEvents(
    token: string,
    billingCycle: { start: number | null; end: number | null },
    signal: AbortSignal,
  ): Promise<{ rows: any[]; truncated: boolean; upstreamTotal: number }> {
    const rows: any[] = [];
    let upstreamTotal = 0;

    for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
      const body: any = { page, pageSize: EVENT_PAGE_SIZE };
      if (billingCycle.start !== null) body.startDate = String(billingCycle.start);
      if (billingCycle.end !== null) body.endDate = String(billingCycle.end);

      const data = await this.fetchJson(CURSOR_EVENTS_URL, token, signal, 'POST', body);
      const pageRows = Array.isArray(data?.usageEventsDisplay) ? data.usageEventsDisplay : [];
      upstreamTotal = Number(data?.totalUsageEventsCount || pageRows.length);
      rows.push(...pageRows);
      if (pageRows.length < EVENT_PAGE_SIZE || rows.length >= upstreamTotal) break;
    }

    return { rows, truncated: rows.length < upstreamTotal, upstreamTotal };
  }

  /** 聚合成与参考站点一致的报告结构。 */
  buildReport(
    summaryInput: any,
    meInput: any,
    rawEvents: any[],
    metadata: { truncated?: boolean; upstreamTotal?: number } = {},
  ): QuotaReport {
    const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : {};
    const me = meInput && typeof meInput === 'object' ? meInput : {};
    const plan = summary?.individualUsage?.plan ?? summary?.plan ?? {};
    const events = (Array.isArray(rawEvents) ? rawEvents : [])
      .filter(isReportableEvent)
      .map(normalizeEvent)
      .sort((a, b) => b.timestamp - a.timestamp);

    const included = events.filter((e) => !e.isOnDemand);
    const onDemand = events.filter((e) => e.isOnDemand);
    const includedAuto = included.filter((e) => isAutoEventFromNormalized(e));
    const includedApi = included.filter((e) => !isAutoEventFromNormalized(e));
    const allAuto = events.filter((e) => isAutoEventFromNormalized(e));
    const allApi = events.filter((e) => !isAutoEventFromNormalized(e));
    const sum = (rows: NormalizedEvent[], key: keyof NormalizedEvent) =>
      rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

    const includedCostCents = sum(included, 'costCents');
    const onDemandCostCents = sum(onDemand, 'costCents');
    const totalCostCents = includedCostCents + onDemandCostCents;
    const membershipType = String(summary.membershipType || 'unknown');
    const membershipKey = membershipType.toLowerCase();
    const planPrice =
      ({ pro: '$20/mo', pro_plus: '$60/mo', ultra: '$200/mo' } as Record<string, string>)[
        membershipKey
      ] ?? '-';

    const modelBreakdown: Record<string, { costCents: number; tokens: number; requests: number }> =
      {};
    for (const event of events) {
      const cur = modelBreakdown[event.model] ?? { costCents: 0, tokens: 0, requests: 0 };
      cur.costCents += event.costCents;
      cur.tokens += event.tokens;
      cur.requests += 1;
      modelBreakdown[event.model] = cur;
    }

    return {
      success: true,
      email: typeof me.email === 'string' ? me.email : '',
      name: typeof me.name === 'string' ? me.name : '',
      membershipType,
      isUnlimited: Boolean(summary.isUnlimited),
      billingCycle: {
        startDateEpochMillis: String(toEpochMillis(summary.billingCycleStart) ?? ''),
        endDateEpochMillis: String(toEpochMillis(summary.billingCycleEnd) ?? ''),
      },
      includedAmountCents: toFiniteNumber(plan.limit) ?? 0,
      includedAmountUsd: formatUsd(plan.limit),
      includedLimitCents: toFiniteNumber(plan.limit) ?? 0,
      includedLimitUsd: formatUsd(plan.limit),
      totalCostCents,
      totalCostUsd: formatUsd(totalCostCents),
      totalRequests: events.length,
      totalTokens: sum(events, 'tokens'),
      includedCostCents,
      includedCostUsd: formatUsd(includedCostCents),
      includedCount: included.length,
      onDemandCostCents,
      onDemandCostUsd: formatUsd(onDemandCostCents),
      onDemandCount: onDemand.length,
      onDemandTokens: sum(onDemand, 'tokens'),
      apiPercentUsed: toFiniteNumber(plan.apiPercentUsed) ?? 0,
      autoPercentUsed: toFiniteNumber(plan.autoPercentUsed) ?? 0,
      totalPercentUsed: toFiniteNumber(plan.totalPercentUsed) ?? 0,
      includedBreakdown: {
        api: {
          costCents: sum(includedApi, 'costCents'),
          costUsd: formatUsd(sum(includedApi, 'costCents')),
          percentUsed: toFiniteNumber(plan.apiPercentUsed) ?? 0,
          tokens: sum(allApi, 'meteredTokens'),
        },
        auto: {
          costCents: sum(includedAuto, 'costCents'),
          costUsd: formatUsd(sum(includedAuto, 'costCents')),
          percentUsed: toFiniteNumber(plan.autoPercentUsed) ?? 0,
          tokens: sum(allAuto, 'meteredTokens'),
        },
      },
      modelBreakdown,
      planInfo: {
        planName: membershipType,
        includedAmountCents: toFiniteNumber(plan.limit) ?? 0,
        price: planPrice,
        billingCycleEnd: String(toEpochMillis(summary.billingCycleEnd) ?? ''),
      },
      events,
      eventsTruncated: Boolean(metadata.truncated),
      upstreamEventCount: Number(metadata.upstreamTotal || events.length),
      queriedAt: new Date().toISOString(),
    };
  }

  /** 查询完整额度报告（摘要 + 账户 + 账期事件）。 */
  async queryReport(rawToken: string): Promise<QuotaReport> {
    const token = normalizeToken(rawToken);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const summary = await this.fetchJson(CURSOR_USAGE_URL, token, controller.signal);
      const billingCycle = {
        start: toEpochMillis(summary.billingCycleStart),
        end: toEpochMillis(summary.billingCycleEnd),
      };
      const [me, eventResult] = await Promise.all([
        this.fetchJson(CURSOR_ME_URL, token, controller.signal).catch(() => ({})),
        this.fetchEvents(token, billingCycle, controller.signal),
      ]);
      return this.buildReport(summary, me, eventResult.rows, {
        truncated: eventResult.truncated,
        upstreamTotal: eventResult.upstreamTotal,
      });
    } catch (error: any) {
      if (error instanceof QuotaCheckError) throw error;
      if (error?.name === 'AbortError') throw new QuotaCheckError('查询超时，请稍后重试', 504);
      this.logger.warn(`queryReport failed: ${error?.message}`);
      throw new QuotaCheckError('无法连接 Cursor 服务，请稍后重试', 502);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** normalizeEvent 后的对象用 model/kind 再判定 auto。 */
function isAutoEventFromNormalized(e: NormalizedEvent): boolean {
  const marker = `${e.model} ${e.kind}`.toLowerCase();
  return marker.includes('auto') || marker.includes('composer');
}
