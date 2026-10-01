import type { AxiosRequestConfig } from 'axios';
import http from './http';

export interface UsageEvent {
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

interface UsageBreakdown {
  costCents: number;
  costUsd: string;
  percentUsed: number;
  tokens: number;
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
  planUsedCents?: number | null;
  planRemainingCents?: number | null;
  officialTotalPercentUsed?: number | null;
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
  officialAggregations: Array<{
    model: string;
    totalCents: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }>;
  apiPercentUsed: number;
  autoPercentUsed: number;
  totalPercentUsed: number;
  includedBreakdown: { api: UsageBreakdown; auto: UsageBreakdown };
  modelBreakdown: Record<string, { costCents: number; tokens: number; requests: number }>;
  planInfo: {
    planName: string;
    includedAmountCents: number;
    price: string;
    billingCycleEnd: string;
  };
  events: UsageEvent[];
  eventsTruncated: boolean;
  upstreamEventCount: number;
  queriedAt: string;
}

export function queryCursorUsage(token: string, signal?: AbortSignal): Promise<QuotaReport> {
  const config: AxiosRequestConfig & { silent: boolean } = {
    timeout: 65_000,
    silent: true,
    signal,
  };
  return http.post<QuotaReport>('/usage-check', { token }, config);
}
