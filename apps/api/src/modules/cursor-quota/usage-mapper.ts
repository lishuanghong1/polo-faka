import { CursorQuotaAccountStatus, Prisma } from '@prisma/client';
import { QuotaReport } from './cursor-usage.service';

export function deriveStatus(
  percent: number | null,
  isUnlimited: boolean,
): CursorQuotaAccountStatus {
  if (isUnlimited) return CursorQuotaAccountStatus.HEALTHY;
  if (percent === null || percent === undefined) return CursorQuotaAccountStatus.UNKNOWN;
  if (percent >= 100) return CursorQuotaAccountStatus.EXHAUSTED;
  if (percent >= 80) return CursorQuotaAccountStatus.LOW_QUOTA;
  return CursorQuotaAccountStatus.HEALTHY;
}

export function reportToAccountUpdate(
  report: QuotaReport,
): Prisma.CursorQuotaAccountUpdateInput {
  const percent = report.totalPercentUsed || null;
  const start = report.billingCycle.startDateEpochMillis
    ? new Date(Number(report.billingCycle.startDateEpochMillis))
    : null;
  const end = report.billingCycle.endDateEpochMillis
    ? new Date(Number(report.billingCycle.endDateEpochMillis))
    : null;

  return {
    membershipType: report.membershipType,
    isUnlimited: report.isUnlimited,
    planUsedCents: report.includedCostCents,
    planLimitCents: report.includedLimitCents,
    planPercent: percent,
    onDemandCents: report.onDemandCostCents,
    totalCostCents: report.totalCostCents,
    billingCycleStart: start,
    billingCycleEnd: end,
    accountStatus: deriveStatus(percent, report.isUnlimited),
    lastCheckedAt: new Date(),
    lastCheckError: null,
  };
}

/** soldAmount = (totalCostCents/100) × pricePerUsd */
export function calcSoldAmount(
  totalCostCents: number | null | undefined,
  pricePerUsd: number | string | null | undefined,
): number {
  const usedUsd = (Number(totalCostCents) || 0) / 100;
  const rate = Number(pricePerUsd) || 0;
  return Number((usedUsd * rate).toFixed(2));
}
