import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * 查 Cursor 账号用量 / 订阅周期（移植自 cursor-jb usage.py）。
 * 鉴权：Cookie WorkosCursorSessionToken=<token>。
 */

const USAGE_SUMMARY_URL = 'https://cursor.com/api/usage-summary';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT = 15000;

export interface CursorUsageResult {
  success: boolean;
  statusCode?: number;
  membershipType?: string | null;
  billingCycleStart?: string | null;
  billingCycleEnd?: string | null;
  planUsed?: number | null;
  planLimit?: number | null;
  planRemaining?: number | null;
  planPercentUsed?: number | null;
  isUnlimited?: boolean;
  error?: string;
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 归一化 token：user_xxx::jwt / %3A%3A → :: */
function normalizeToken(raw: string): string {
  return (raw || '').replace(/%3A%3A/gi, '::').trim();
}

@Injectable()
export class CursorUsageService {
  private readonly logger = new Logger(CursorUsageService.name);

  async fetchUsage(cursorToken: string): Promise<CursorUsageResult> {
    const token = normalizeToken(cursorToken);
    if (!token) return { success: false, error: '缺少 Cursor token' };

    try {
      const resp = await axios.get(USAGE_SUMMARY_URL, {
        timeout: DEFAULT_TIMEOUT,
        // 4xx 不抛，自己判
        validateStatus: (s) => s < 500,
        headers: {
          Cookie: `WorkosCursorSessionToken=${token}`,
          Accept: 'application/json',
          'User-Agent': BROWSER_UA,
        },
      });
      if (resp.status === 401) {
        return { success: false, statusCode: 401, error: 'token 已失效，请重新获取' };
      }
      if (resp.status >= 400) {
        return {
          success: false,
          statusCode: resp.status,
          error: `Cursor 返回 HTTP ${resp.status}`,
        };
      }
      const data = resp.data || {};
      const individual = data.individualUsage || {};
      const plan = individual.plan || {};
      return {
        success: true,
        statusCode: resp.status,
        membershipType: data.membershipType ?? null,
        billingCycleStart: data.billingCycleStart ?? null,
        billingCycleEnd: data.billingCycleEnd ?? null,
        planUsed: toNumber(plan.used),
        planLimit: toNumber(plan.limit),
        planRemaining: toNumber(plan.remaining),
        planPercentUsed: toNumber(plan.totalPercentUsed ?? plan.apiPercentUsed),
        isUnlimited: !!data.isUnlimited,
      };
    } catch (e) {
      const msg = (e as Error)?.message || '网络错误';
      this.logger.warn(`fetchUsage failed: ${msg}`);
      return { success: false, error: `网络错误: ${msg}` };
    }
  }
}
