import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  classifyUsageEvent,
  distributeCents,
  eventDetailCostCents,
  eventTypeName,
  includedQuotaPercent,
  normalizeOfficialAggregations,
  officialEventCents,
  officialPlanCents,
  OfficialAggregation,
  summaryOnDemandCents,
} from './cursor-event-pricing';

/**
 * Cursor 额度查询服务。
 * 计费口径对齐 https://goushicursor.chat/usage-check：
 *  - /api/usage-summary  会员、账期、plan used/limit、按需 used（美分）
 *  - /api/dashboard/get-aggregated-usage-events  官网套餐聚合 totalCostCents
 *  - /api/dashboard/get-filtered-usage-events  账期逐条用量
 * 号池计费 = 套餐聚合 + usage-summary 按需 + FREE_CREDIT。
 */

const CURSOR_ORIGIN = 'https://cursor.com';
const CURSOR_USAGE_URL =
  process.env.CURSOR_USAGE_SUMMARY_ENDPOINT || 'https://cursor.com/api/usage-summary';
const CURSOR_ME_URL = process.env.CURSOR_ME_ENDPOINT || 'https://cursor.com/api/auth/me';
const CURSOR_EVENTS_URL =
  process.env.CURSOR_USAGE_EVENTS_ENDPOINT ||
  'https://cursor.com/api/dashboard/get-filtered-usage-events';
const CURSOR_AGGREGATED_URL =
  process.env.CURSOR_USAGE_AGGREGATED_ENDPOINT ||
  'https://cursor.com/api/dashboard/get-aggregated-usage-events';
const DEFAULT_TIMEOUT_MS = Number(process.env.CURSOR_QUOTA_TIMEOUT_MS || 45_000);
const EVENT_PAGE_SIZE = 500;
const MAX_EVENT_PAGES = Math.max(
  1,
  Math.floor(Number(process.env.CURSOR_USAGE_MAX_EVENT_PAGES || 20) || 20),
);

const WORKOS_TOKEN_PATTERN =
  /^user_[A-Za-z0-9_-]+::[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * 带 HTTP 状态码的可控业务错误。
 * 继承 HttpException：直接抛出时全局过滤器能按真实状态码返回错误信息，
 * 而不是被当成未处理异常吞成 500 Internal server error。
 */
export class QuotaCheckError extends HttpException {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message, statusCode);
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
  officialPlanCents: number;
  officialPlanUsd: string;
  officialOnDemandCents: number;
  officialOnDemandUsd: string;
  officialTotalCents: number;
  officialTotalUsd: string;
  freeCreditCents: number;
  freeCreditUsd: string;
  freeCreditCount: number;
  officialAggregations: OfficialAggregation[];
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
  officialCents: number;
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

/**
 * 把一组可能含小数的美分汇总为整数美分。
 * 先保留各项整数部分，再按小数余数从大到小分配尾差，确保分项之和等于目标总额。
 */
function allocateRoundedCents(values: number[], targetTotal?: number): number[] {
  if (!values.length) return [];
  const normalized = values.map((value) =>
    Number.isFinite(value) ? Math.max(0, value) : 0,
  );
  const result = normalized.map(Math.floor);
  const target =
    targetTotal === undefined
      ? Math.round(normalized.reduce((total, value) => total + value, 0))
      : Math.max(0, Math.round(targetTotal));
  const remainder = Math.max(0, target - result.reduce((total, value) => total + value, 0));
  const order = normalized
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i += 1) {
    result[order[i % order.length].index] += 1;
  }
  return result;
}

function isReportableEvent(event: any): boolean {
  return Boolean(event && typeof event === 'object' && event.timestamp);
}

function normalizeEvent(event: any): NormalizedEvent {
  const timestamp = toFiniteNumber(event?.timestamp) ?? 0;
  const category = classifyUsageEvent(event);
  const costCents = eventDetailCostCents(event);
  return {
    timestamp,
    model: String(event?.model || 'unknown'),
    kind: String(event?.kind || 'unknown'),
    isOnDemand: category === 'usage_based',
    typeName: eventTypeName(category),
    tokens: eventTokenTotal(event),
    meteredTokens: eventMeteredTokenTotal(event),
    costCents,
    officialCents: officialEventCents(event),
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
      rows.push(...pageRows);
      const reportedTotal = toFiniteNumber(data?.totalUsageEventsCount);
      upstreamTotal =
        reportedTotal === null
          ? rows.length + (pageRows.length === EVENT_PAGE_SIZE ? 1 : 0)
          : Math.max(0, reportedTotal);
      if (
        pageRows.length < EVENT_PAGE_SIZE ||
        (reportedTotal !== null && rows.length >= upstreamTotal)
      ) {
        break;
      }
    }

    return { rows, truncated: rows.length < upstreamTotal, upstreamTotal };
  }

  /** 官网模型聚合，失败时由调用方回退到事件合计。 */
  private async fetchAggregated(
    token: string,
    billingCycle: { start: number | null; end: number | null },
    signal: AbortSignal,
  ): Promise<any> {
    const body: Record<string, number> = { teamId: -1 };
    if (billingCycle.start !== null) body.startDate = billingCycle.start;
    if (billingCycle.end !== null) body.endDate = billingCycle.end;
    return this.fetchJson(CURSOR_AGGREGATED_URL, token, signal, 'POST', body);
  }

  /** 聚合成与参考站点一致的报告结构。 */
  buildReport(
    summaryInput: any,
    meInput: any,
    rawEvents: any[],
    metadata: { truncated?: boolean; upstreamTotal?: number; aggregated?: any } = {},
  ): QuotaReport {
    const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : {};
    const me = meInput && typeof meInput === 'object' ? meInput : {};
    const plan = summary?.individualUsage?.plan ?? summary?.plan ?? {};
    const rawRows = (Array.isArray(rawEvents) ? rawEvents : []).filter(isReportableEvent);
    const events = rawRows.map(normalizeEvent).sort((a, b) => b.timestamp - a.timestamp);

    const included = events.filter((e) => e.typeName === '套餐内');
    const onDemand = events.filter((e) => e.isOnDemand);
    const freeCreditEvents = events.filter((e) => e.typeName === '赠送金');
    const includedAuto = included.filter((e) => isAutoEventFromNormalized(e));
    const includedApi = included.filter((e) => !isAutoEventFromNormalized(e));
    const allAuto = events.filter((e) => isAutoEventFromNormalized(e));
    const allApi = events.filter((e) => !isAutoEventFromNormalized(e));
    const sum = (rows: NormalizedEvent[], key: keyof NormalizedEvent) =>
      rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

    const includedEventOfficialCents = rawRows
      .filter((event) => classifyUsageEvent(event) === 'included')
      .reduce((total, event) => total + officialEventCents(event), 0);
    const officialPlanRaw = officialPlanCents({
      aggregated: metadata.aggregated,
      summary,
      includedEventCents: includedEventOfficialCents,
    });
    const officialOnDemandRaw = summaryOnDemandCents(summary);
    const freeCreditRaw = sum(freeCreditEvents, 'costCents');
    const officialPlanCentsRounded = Math.round(officialPlanRaw);
    const officialOnDemandCents = Math.round(officialOnDemandRaw);
    const freeCreditCents = Math.round(freeCreditRaw);
    const officialTotalCents = officialPlanCentsRounded + officialOnDemandCents;
    const totalCostCents = officialTotalCents + freeCreditCents;
    const includedCostCents = officialPlanCentsRounded;
    const onDemandCostCents = officialOnDemandCents;
    const officialAggregations = normalizeOfficialAggregations(metadata.aggregated);
    const [includedApiCostCents, includedAutoCostCents] = allocateRoundedCents(
      [sum(includedApi, 'officialCents'), sum(includedAuto, 'officialCents')],
      includedCostCents,
    );
    const includedLimitCents = Math.round(Math.max(0, toFiniteNumber(plan.limit) ?? 0));
    const membershipType = String(summary.membershipType || 'unknown');
    const membershipKey = membershipType.toLowerCase();
    const planPrice =
      ({ pro: '$20/mo', pro_plus: '$60/mo', ultra: '$200/mo', enterprise: 'Enterprise' } as Record<
        string,
        string
      >)[membershipKey] ?? '-';

    const modelBreakdown = buildBillingModelBreakdown(rawRows, {
      officialPlanCents: officialPlanRaw,
      officialOnDemandCents: officialOnDemandRaw,
      officialAggregations,
    });

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
      includedAmountCents: includedLimitCents,
      includedAmountUsd: formatUsd(includedLimitCents),
      includedLimitCents,
      includedLimitUsd: formatUsd(includedLimitCents),
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
      officialPlanCents: officialPlanCentsRounded,
      officialPlanUsd: formatUsd(officialPlanCentsRounded),
      officialOnDemandCents,
      officialOnDemandUsd: formatUsd(officialOnDemandCents),
      officialTotalCents,
      officialTotalUsd: formatUsd(officialTotalCents),
      freeCreditCents,
      freeCreditUsd: formatUsd(freeCreditCents),
      freeCreditCount: freeCreditEvents.length,
      officialAggregations,
      apiPercentUsed: toFiniteNumber(plan.apiPercentUsed) ?? 0,
      autoPercentUsed: toFiniteNumber(plan.autoPercentUsed) ?? 0,
      totalPercentUsed: includedQuotaPercent(plan),
      includedBreakdown: {
        api: {
          costCents: includedApiCostCents,
          costUsd: formatUsd(includedApiCostCents),
          percentUsed: toFiniteNumber(plan.apiPercentUsed) ?? 0,
          tokens: sum(allApi, 'meteredTokens'),
        },
        auto: {
          costCents: includedAutoCostCents,
          costUsd: formatUsd(includedAutoCostCents),
          percentUsed: toFiniteNumber(plan.autoPercentUsed) ?? 0,
          tokens: sum(allAuto, 'meteredTokens'),
        },
      },
      modelBreakdown,
      planInfo: {
        planName: membershipType,
        includedAmountCents: includedLimitCents,
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
      const [me, eventResult, aggregated] = await Promise.all([
        this.fetchJson(CURSOR_ME_URL, token, controller.signal).catch(() => ({})),
        this.fetchEvents(token, billingCycle, controller.signal),
        this.fetchAggregated(token, billingCycle, controller.signal).catch((error) => {
          this.logger.warn(`fetch aggregated usage failed: ${error?.message || error}`);
          return null;
        }),
      ]);
      if (eventResult.truncated) {
        throw new QuotaCheckError(
          `账期用量超过 ${EVENT_PAGE_SIZE * MAX_EVENT_PAGES} 条，无法完整计算模型收益，请提高 CURSOR_USAGE_MAX_EVENT_PAGES 后重试`,
          422,
        );
      }
      return this.buildReport(summary, me, eventResult.rows, {
        truncated: eventResult.truncated,
        upstreamTotal: eventResult.upstreamTotal,
        aggregated,
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

/** normalizeEvent 后的对象用 model/kind 再判定 auto（cursor-grok 系列官方口径计入 Auto）。 */
function isAutoEventFromNormalized(e: NormalizedEvent): boolean {
  const marker = `${e.model} ${e.kind}`.toLowerCase();
  return marker.includes('auto') || marker.includes('composer') || marker.includes('cursor-grok');
}

function emptyModelRow() {
  return { costCents: 0, tokens: 0, requests: 0 };
}

/** 号池收益按官网套餐聚合 + 按需（缩放到 usage-summary）+ 赠送金拆到各模型。 */
function buildBillingModelBreakdown(
  rawEvents: any[],
  params: {
    officialPlanCents: number;
    officialOnDemandCents: number;
    officialAggregations: OfficialAggregation[];
  },
): Record<string, { costCents: number; tokens: number; requests: number }> {
  const modelBreakdown: Record<string, { costCents: number; tokens: number; requests: number }> = {};
  const ensure = (model: string) => {
    const key = model || 'unknown';
    modelBreakdown[key] = modelBreakdown[key] ?? emptyModelRow();
    return modelBreakdown[key];
  };

  if (params.officialAggregations.length) {
    for (const row of params.officialAggregations) {
      ensure(row.model).costCents += row.totalCents;
    }
  } else {
    for (const event of rawEvents) {
      if (classifyUsageEvent(event) !== 'included') continue;
      const current = ensure(String(event?.model || 'unknown'));
      current.costCents += officialEventCents(event);
    }
  }

  const onDemandRows = rawEvents
    .filter((event) => classifyUsageEvent(event) === 'usage_based')
    .map((event) => ({
      model: String(event?.model || 'unknown'),
      costCents: eventDetailCostCents(event) || officialEventCents(event),
    }));
  const scaledOnDemand =
    params.officialOnDemandCents > 0
      ? onDemandRows.length
        ? distributeCents(onDemandRows, params.officialOnDemandCents)
        : [{ model: 'on-demand', costCents: params.officialOnDemandCents }]
      : [];
  for (const row of scaledOnDemand) {
    ensure(row.model).costCents += row.costCents;
  }

  for (const event of rawEvents) {
    const category = classifyUsageEvent(event);
    if (category === 'errored') continue;
    const current = ensure(String(event?.model || 'unknown'));
    current.tokens += eventTokenTotal(event);
    current.requests += 1;
    if (category === 'free_credit') current.costCents += eventDetailCostCents(event);
  }

  return modelBreakdown;
}
