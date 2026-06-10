import type { Account, UsageInfo } from '../types';

/** 账号库记录 → 用量计算结构 */
export function accountToUsageInfo(a: Account): UsageInfo {
  return {
    plan: a.plan,
    userId: a.userId,
    totalSpendUsd: a.totalSpendUsd,
    includedSpendUsd: a.includedSpendUsd,
    limitUsd: a.limitUsd,
    remainingUsd: a.remainingUsd,
    bonusQuotaUsd: a.bonusQuotaUsd,
    bonusUsedUsd: a.bonusUsedUsd,
    bonusSpendUsd: a.bonusUsedUsd,
    apiSpendUsd: a.apiSpendUsd,
    overageSpendUsd: a.overageSpendUsd,
    autoPercent: a.autoPercent,
    apiPercent: a.apiPercent,
    totalPercent: a.totalPercent,
    individualLimitUsd: a.individualLimitUsd,
    individualUsedUsd: a.individualUsedUsd,
    periodStart: a.periodStart,
    periodEnd: a.periodEnd,
    requestsUsed: null,
    requestsLimit: null,
    source: (a.usageSource as UsageInfo['source']) ?? 'usage_summary',
  };
}

/** Total 用量百分比（对齐 Cockpit：优先 totalPercent，否则用套餐金额推算） */
export function resolveTotalPercent(u: UsageInfo): number | null {
  if (u.totalPercent !== null && u.totalPercent !== undefined) {
    return u.totalPercent;
  }
  const quota = resolvePlanQuotaMoney(u);
  if (quota && quota.limit > 0) {
    return (quota.used / quota.limit) * 100;
  }
  return null;
}

/** 套餐额度：includedSpend / limit（Cockpit planUsedCents / planLimitCents） */
export function resolvePlanQuotaMoney(
  u: UsageInfo,
): { used: number; limit: number } | null {
  if (u.limitUsd === null || u.limitUsd === undefined) return null;
  const used = u.includedSpendUsd ?? u.totalSpendUsd;
  if (used === null || used === undefined) return null;
  return { used, limit: u.limitUsd };
}

function positiveDelta(a: number, b: number): number | null {
  const d = a - b;
  return d > 0.001 ? d : null;
}

/** 套餐额度是否已用尽（用完但未超金额） */
export function resolvePlanExhausted(u: UsageInfo): boolean {
  if (u.limitUsd == null || u.limitUsd <= 0) return false;
  if (u.remainingUsd != null && u.remainingUsd <= 0.001) return true;
  const quota = resolvePlanQuotaMoney(u);
  return quota != null && quota.used >= quota.limit - 0.001;
}

/** 子配额满额提示 */
export function resolveSubQuotaAlerts(u: UsageInfo): string[] {
  const alerts: string[] = [];
  if (u.apiPercent != null && u.apiPercent >= 99.9) {
    alerts.push('API 配额已满');
  }
  if (u.autoPercent != null && u.autoPercent >= 99.9) {
    alerts.push('Auto 配额已满');
  }
  return alerts;
}

/** 套餐超额：计入额度超出套餐上限的部分 */
export function resolvePlanOverage(u: UsageInfo): number | null {
  if (u.remainingUsd != null && u.remainingUsd < -0.001) {
    return Math.abs(u.remainingUsd);
  }
  const quota = resolvePlanQuotaMoney(u);
  if (!quota) return null;
  return positiveDelta(quota.used, quota.limit);
}

/** 总花费超出套餐上限（含赠送/按需等产生的额外花费） */
export function resolveTotalOverage(u: UsageInfo): number | null {
  if (u.limitUsd == null || u.totalSpendUsd == null) return null;
  return positiveDelta(u.totalSpendUsd, u.limitUsd);
}

/** 总花费超出「计入额度」的部分（走赠送/按需等） */
export function resolveBeyondIncluded(u: UsageInfo): number | null {
  if (u.totalSpendUsd == null || u.includedSpendUsd == null) return null;
  return positiveDelta(u.totalSpendUsd, u.includedSpendUsd);
}

export function resolveBonusUsed(u: UsageInfo): number | null {
  const used = u.bonusUsedUsd ?? u.bonusSpendUsd;
  if (used == null || used <= 0.001) return null;
  return used;
}

export function resolveBonusQuota(u: UsageInfo): number | null {
  return u.bonusQuotaUsd ?? null;
}

/** On-Demand 按需付费（Cockpit onDemand / spendLimitUsage） */
export function resolveOnDemand(
  u: UsageInfo,
): { used: number; limit: number | null; overage: number | null } | null {
  const used = u.individualUsedUsd;
  const limit = u.individualLimitUsd;
  if (used == null && limit == null) return null;
  const usedVal = used ?? 0;
  const overage =
    limit != null && limit > 0 ? positiveDelta(usedVal, limit) : null;
  return { used: usedVal, limit: limit ?? null, overage };
}

export type UsageOverageSummary = {
  planOverage: number | null;
  totalOverage: number | null;
  beyondIncluded: number | null;
  bonusUsed: number | null;
  bonusQuota: number | null;
  planExhausted: boolean;
  subQuotaAlerts: string[];
  onDemand: ReturnType<typeof resolveOnDemand>;
  /** 有金额意义上的超额 */
  hasDollarOverage: boolean;
  /** 有预警（用尽 / 子配额满 / 赠送消耗等） */
  hasWarnings: boolean;
  hasAny: boolean;
};

export function resolveUsageOverage(u: UsageInfo): UsageOverageSummary {
  const planOverage = resolvePlanOverage(u);
  const totalOverage = resolveTotalOverage(u);
  const beyondIncluded = resolveBeyondIncluded(u);
  const bonusUsed = resolveBonusUsed(u);
  const bonusQuota = resolveBonusQuota(u);
  const planExhausted = resolvePlanExhausted(u);
  const subQuotaAlerts = resolveSubQuotaAlerts(u);
  const onDemand = resolveOnDemand(u);

  const hasDollarOverage =
    planOverage != null ||
    totalOverage != null ||
    beyondIncluded != null ||
    onDemand?.overage != null;

  const hasWarnings =
    planExhausted ||
    subQuotaAlerts.length > 0 ||
    bonusUsed != null ||
    (onDemand != null && onDemand.used > 0);

  const hasAny = hasDollarOverage || hasWarnings;

  return {
    planOverage,
    totalOverage,
    beyondIncluded,
    bonusUsed,
    bonusQuota,
    planExhausted,
    subQuotaAlerts,
    onDemand,
    hasDollarOverage,
    hasWarnings,
    hasAny,
  };
}

/** 高级模型总计 = API + 超额 + 奖励 */
export type UsageTotalSummary = {
  api: number;
  overage: number;
  bonus: number;
  total: number;
};

function nz(v: number | null | undefined): number {
  return v != null && v > 0 ? v : 0;
}

/** API 高级模型花费 */
export function resolveApiSpend(u: UsageInfo): number {
  if (u.apiSpendUsd != null && u.apiSpendUsd > 0) return u.apiSpendUsd;
  if (u.limitUsd != null && u.apiPercent != null && u.apiPercent > 0) {
    return (u.limitUsd * u.apiPercent) / 100;
  }
  return 0;
}

/** 超额 / 按需花费 */
export function resolveOverageSpend(u: UsageInfo): number {
  return nz(u.overageSpendUsd ?? u.individualUsedUsd);
}

/** 奖励 / 赠送池已消耗 */
export function resolveBonusSpend(u: UsageInfo): number {
  return nz(resolveBonusUsed(u));
}

export function resolveUsageTotalSummary(u: UsageInfo): UsageTotalSummary | null {
  const api = resolveApiSpend(u);
  const overage = resolveOverageSpend(u);
  const bonus = resolveBonusSpend(u);
  const total = api + overage + bonus;

  const hasSignal =
    total > 0 ||
    u.apiPercent != null ||
    u.overageSpendUsd != null ||
    u.individualUsedUsd != null ||
    resolveBonusUsed(u) != null ||
    u.apiSpendUsd != null;

  if (!hasSignal) return null;
  return { api, overage, bonus, total };
}
