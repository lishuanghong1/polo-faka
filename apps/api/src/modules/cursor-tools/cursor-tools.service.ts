import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * Cursor 网页版 token 信息查询。
 *
 * 注意：所有方法仅用一次 token，本服务不缓存、不持久化、不写日志中体现 token。
 * 仅对外暴露归集后的安全字段。
 */
@Injectable()
export class CursorToolsService {
  private readonly logger = new Logger('CursorTools');
  private readonly baseUrl = 'https://www.cursor.com';
  private readonly stripeUrl = 'https://api2.cursor.sh';
  private readonly timeoutMs = 8000;

  /**
   * 用 token 充当 cookie，并行调几个 cursor.com 接口拿信息。
   * 返回值统一脱敏，调用方安全展示。
   */
  async inspect(rawToken: string): Promise<{
    valid: boolean;
    email?: string | null;
    name?: string | null;
    picture?: string | null;
    sub?: string | null;
    membership?: any;
    usage?: any;
    stripe?: any;
    errors: string[];
  }> {
    const token = String(rawToken || '').trim();
    if (!token) {
      return { valid: false, errors: ['empty token'] };
    }
    const cookieVal = encodeURIComponent(token);
    const cookie = `WorkosCursorSessionToken=${cookieVal}`;
    const headers = {
      Cookie: cookie,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.cursor.com/dashboard',
    } as Record<string, string>;

    const errors: string[] = [];

    const safeGet = async (url: string, label: string) => {
      try {
        const r = await axios.get(url, {
          headers,
          timeout: this.timeoutMs,
          validateStatus: () => true,
        });
        if (r.status >= 200 && r.status < 300) return r.data;
        errors.push(`${label}: HTTP ${r.status}`);
        return null;
      } catch (e: any) {
        errors.push(`${label}: ${e?.code || e?.message || 'network error'}`);
        return null;
      }
    };

    const safePost = async (url: string, body: any, label: string) => {
      try {
        const r = await axios.post(url, body ?? {}, {
          headers: { ...headers, 'Content-Type': 'application/json' },
          timeout: this.timeoutMs,
          validateStatus: () => true,
        });
        if (r.status >= 200 && r.status < 300) return r.data;
        errors.push(`${label}: HTTP ${r.status}`);
        return null;
      } catch (e: any) {
        errors.push(`${label}: ${e?.code || e?.message || 'network error'}`);
        return null;
      }
    };

    // 并行请求，互不阻塞
    const [me, usage, stripe] = await Promise.all([
      safeGet(`${this.baseUrl}/api/auth/me`, 'me'),
      safeGet(`${this.baseUrl}/api/usage`, 'usage'),
      safeGet(`${this.stripeUrl}/auth/full_stripe_profile`, 'stripe'),
    ]);

    // membership 是 POST
    const membership = await safePost(
      `${this.baseUrl}/api/dashboard/get-user-membership`,
      {},
      'membership',
    );

    // 任何一个接口成功 -> 视为 token 有效
    const valid = !!(me || usage || stripe || membership);

    return {
      valid,
      email: me?.email ?? me?.user?.email ?? stripe?.email ?? null,
      name: me?.name ?? me?.user?.name ?? null,
      picture: me?.picture ?? me?.user?.picture ?? null,
      sub: me?.sub ?? me?.user?.sub ?? null,
      membership: this.sanitize(membership),
      usage: this.sanitize(usage),
      stripe: this.pickStripe(stripe),
      errors,
    };
  }

  /** 通用脱敏：丢掉过长字段、token-like 字段 */
  private sanitize(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj ?? null;
    if (Array.isArray(obj)) return obj.map((v) => this.sanitize(v));
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase();
      if (
        lk.includes('token') ||
        lk.includes('secret') ||
        lk.includes('cookie') ||
        lk.includes('password')
      ) {
        continue;
      }
      if (typeof v === 'string' && v.length > 512) continue;
      out[k] = typeof v === 'object' ? this.sanitize(v) : v;
    }
    return out;
  }

  /** Stripe profile 中只保留对用户有意义的几个字段 */
  private pickStripe(obj: any): any {
    if (!obj || typeof obj !== 'object') return null;
    const sub = obj?.customer?.subscriptions?.data?.[0];
    return {
      membershipType: obj?.membershipType ?? null,
      trialEligible: obj?.trialEligible ?? null,
      trialEnd: obj?.trialEnd ?? null,
      verifiedStudent: obj?.verifiedStudent ?? null,
      subscriptionStatus: sub?.status ?? null,
      currentPeriodEnd: sub?.current_period_end ?? null,
      cancelAtPeriodEnd: sub?.cancel_at_period_end ?? null,
      plan: sub?.plan?.nickname ?? sub?.items?.data?.[0]?.price?.nickname ?? null,
    };
  }
}
