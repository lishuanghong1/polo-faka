import { normalizeToken } from '../cursor-quota/cursor-usage.service';
import { includedQuotaPercent } from '../cursor-quota/cursor-event-pricing';

const CURSOR_ORIGIN = 'https://cursor.com';
const CURSOR_USAGE_URL =
  process.env.CURSOR_USAGE_SUMMARY_ENDPOINT || 'https://cursor.com/api/usage-summary';
const CHECK_TIMEOUT_MS = Number(process.env.VAULT_CHECK_TIMEOUT_MS || 20_000);

export interface VaultCheckResult {
  result: 'VALID' | 'INVALID' | 'ERROR';
  message: string;
  membershipType: string | null;
  planUsedCents: number | null;
  planLimitCents: number | null;
  planPercent: number | null;
}

function toFinite(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 轻量有效性检测：只打 usage-summary 一个接口。
 * 与额度号池的全量报告不同，这里只判断 Token 是否存活并抓一份用量快照。
 */
export async function checkCursorToken(rawToken: string): Promise<VaultCheckResult> {
  const fail = (result: 'INVALID' | 'ERROR', message: string): VaultCheckResult => ({
    result,
    message,
    membershipType: null,
    planUsedCents: null,
    planLimitCents: null,
    planPercent: null,
  });

  let token: string;
  try {
    token = normalizeToken(rawToken);
  } catch (e: any) {
    return fail('INVALID', e?.message || 'Token 格式不正确');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(CURSOR_USAGE_URL, {
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Cookie: `WorkosCursorSessionToken=${encodeURIComponent(token)}`,
        Origin: CURSOR_ORIGIN,
        Referer: `${CURSOR_ORIGIN}/dashboard/usage`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      },
    });

    if (response.status === 401 || response.status === 403) {
      return fail('INVALID', 'Token 已失效或无权查询');
    }
    if (!response.ok) {
      return fail('ERROR', `Cursor 服务异常（HTTP ${response.status}）`);
    }

    let data: any;
    try {
      data = JSON.parse(await response.text());
    } catch {
      return fail('ERROR', 'Cursor 返回了无法识别的数据');
    }

    const plan = data?.individualUsage?.plan ?? {};
    const usedCents = toFinite(plan.used);
    const limitCents = toFinite(plan.limit);
    const percent = includedQuotaPercent(plan);
    const membershipType =
      typeof data?.membershipType === 'string' ? data.membershipType : null;

    return {
      result: 'VALID',
      message: membershipType ? `有效（${membershipType}）` : '有效',
      membershipType,
      planUsedCents: usedCents === null ? null : Math.round(usedCents),
      planLimitCents: limitCents === null ? null : Math.round(limitCents),
      planPercent: Number.isFinite(percent) ? Number(percent.toFixed(2)) : null,
    };
  } catch (e: any) {
    if (e?.name === 'AbortError') return fail('ERROR', '检测超时');
    return fail('ERROR', `无法连接 Cursor（${e?.message || e}）`);
  } finally {
    clearTimeout(timer);
  }
}
