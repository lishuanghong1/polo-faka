/**
 * 额度号池用量口径，对齐 goushicursor.chat/usage-check：
 *  - 套餐+按需（官方账单）= 聚合 totalCostCents + usage-summary.onDemand
 *  - 赠送金 FREE_CREDIT 单独统计，号池计费再加回去
 *  - 明细优先 chargedCents，其次 totalCents+cursorTokenFee，再次 requestsCosts×$0.04
 */

export const REQUEST_UNIT_USD = 0.04;

export type UsageEventKind =
  | 'included'
  | 'usage_based'
  | 'free_credit'
  | 'errored'
  | 'other';

export interface OfficialAggregation {
  model: string;
  totalCents: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumber(value: unknown): number {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 ? n : 0;
}

export function classifyUsageEvent(event: any): UsageEventKind {
  const kind = String(event?.kind || '');
  if (kind === 'USAGE_EVENT_KIND_ERRORED_NOT_CHARGED') return 'errored';
  if (kind === 'USAGE_EVENT_KIND_FREE_CREDIT') return 'free_credit';
  if (kind === 'USAGE_EVENT_KIND_USAGE_BASED') return 'usage_based';
  if (/^USAGE_EVENT_KIND_INCLUDED_IN_/i.test(kind)) return 'included';
  return 'other';
}

export function eventTypeName(kind: UsageEventKind): string {
  if (kind === 'included') return '套餐内';
  if (kind === 'usage_based') return '超额';
  if (kind === 'free_credit') return '赠送金';
  if (kind === 'errored') return '错误未计费';
  return '其他';
}

/** 官网聚合口径：只取 tokenUsage.totalCents，不含 cursorTokenFee。 */
export function officialEventCents(event: any): number {
  if (classifyUsageEvent(event) === 'errored') return 0;
  return Math.max(0, toFiniteNumber(event?.tokenUsage?.totalCents) ?? 0);
}

function isAutoPricedModel(model: unknown): boolean {
  const name = String(model || '').trim().toLowerCase();
  return !name || name === 'default' || name === 'auto' || name === 'auto-cost' || /^auto[-_]/.test(name);
}

/**
 * 单条明细美元。与参考站一致：
 * chargedCents > (totalCents + cursorTokenFee) > requestsCosts×$0.04 > usageBasedCosts
 */
export function eventDetailCostUsd(event: any): number {
  if (classifyUsageEvent(event) === 'errored') return 0;

  const charged = positiveNumber(event?.chargedCents ?? event?.charged_cents);
  if (charged > 0) return charged / 100;

  const totalCents = positiveNumber(event?.tokenUsage?.totalCents ?? event?.tokenUsage?.total_cents);
  const tokenFee = positiveNumber(event?.cursorTokenFee ?? event?.cursor_token_fee);
  if (totalCents > 0 || tokenFee > 0) return (totalCents + tokenFee) / 100;

  const requestUnits = positiveNumber(event?.requestsCosts ?? event?.requests_costs);
  if (requestUnits > 0 && !isAutoPricedModel(event?.model ?? event?.modelName)) {
    return requestUnits * REQUEST_UNIT_USD;
  }

  const usageBased = event?.usageBasedCosts ?? event?.usage_based_costs;
  if (usageBased && usageBased !== '-') {
    const parsed = Number(String(usageBased).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return 0;
}

export function eventDetailCostCents(event: any): number {
  return eventDetailCostUsd(event) * 100;
}

export function normalizeOfficialAggregations(input: unknown): OfficialAggregation[] {
  const rows = Array.isArray((input as any)?.aggregations)
    ? (input as any).aggregations
    : Array.isArray(input)
      ? input
      : [];
  return rows
    .map((row: any) => ({
      model: String(row?.modelIntent || row?.model || 'unknown'),
      totalCents: Math.max(0, toFiniteNumber(row?.totalCents) ?? 0),
      inputTokens: Math.max(0, toFiniteNumber(row?.inputTokens) ?? 0),
      outputTokens: Math.max(0, toFiniteNumber(row?.outputTokens) ?? 0),
      cacheReadTokens: Math.max(0, toFiniteNumber(row?.cacheReadTokens) ?? 0),
      cacheWriteTokens: Math.max(0, toFiniteNumber(row?.cacheWriteTokens) ?? 0),
    }))
    .filter((row: OfficialAggregation) => row.model);
}

export function aggregatedPlanCents(aggregated: any, fallback = 0): number {
  const direct = toFiniteNumber(aggregated?.totalCostCents);
  if (direct !== null && direct >= 0) return direct;
  const rows = normalizeOfficialAggregations(aggregated);
  if (!rows.length) return fallback;
  return rows.reduce((sum, row) => sum + row.totalCents, 0);
}

export function summaryOnDemandCents(summary: any): number {
  const individual = summary?.individualUsage ?? summary ?? {};
  const onDemand = individual.onDemand ?? summary?.onDemand ?? {};
  return Math.max(0, toFiniteNumber(onDemand.used) ?? 0);
}

/** 套餐官方入账：聚合 totalCostCents，其次 plan.breakdown.total，再次套餐内事件合计。 */
export function officialPlanCents(params: {
  aggregated?: any;
  summary?: any;
  includedEventCents?: number;
}): number {
  const aggregated = aggregatedPlanCents(params.aggregated, Number.NaN);
  if (Number.isFinite(aggregated) && (aggregated > 0 || params.aggregated?.aggregations)) {
    return Math.max(0, aggregated);
  }
  const breakdownTotal = toFiniteNumber(params.summary?.individualUsage?.plan?.breakdown?.total);
  if (breakdownTotal !== null && breakdownTotal > 0) return breakdownTotal;
  return Math.max(0, params.includedEventCents ?? 0);
}

export function includedQuotaPercent(plan: any): number {
  const used = toFiniteNumber(plan?.used);
  const limit = toFiniteNumber(plan?.limit);
  if (used !== null && limit !== null && limit > 0) {
    return Math.max(0, (used / limit) * 100);
  }
  return (
    toFiniteNumber(plan?.totalPercentUsed) ??
    toFiniteNumber(plan?.apiPercentUsed) ??
    0
  );
}

export function distributeCents<T extends { costCents: number }>(
  rows: T[],
  targetCents: number,
): T[] {
  const target = Math.max(0, targetCents);
  const current = rows.reduce((sum, row) => sum + Math.max(0, row.costCents), 0);
  if (target === 0 || rows.length === 0) return rows.map((row) => ({ ...row, costCents: 0 }));
  if (current <= 0) {
    const share = target / rows.length;
    return rows.map((row) => ({ ...row, costCents: share }));
  }
  const scale = target / current;
  return rows.map((row) => ({ ...row, costCents: Math.max(0, row.costCents) * scale }));
}
