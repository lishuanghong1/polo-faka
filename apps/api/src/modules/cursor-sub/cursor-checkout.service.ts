import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';

/**
 * 用账号的 WorkosCursorSessionToken 调 Cursor 后端「创建 Pro 结账会话」，
 * 拿到 checkout.stripe.com/c/pay/cs_live_... 链接（买家自己在 Stripe 页面付款）。
 *
 * 抓包结论（点 Upgrade to Pro 背后的接口）：
 *   GET https://cursor.com/api/auth/checkoutDeepControl?tier=pro
 *   Cookie: WorkosCursorSessionToken=<token>
 *   → 302  Location: https://checkout.stripe.com/c/pay/cs_live_...
 * 每次调用生成一条新的结账会话；纯 HTTP，无 CSRF / 无验证码。
 * token 失效 / 已是 Pro / 不可升级时会 302 回 /dashboard。
 */

const CHECKOUT_URL = 'https://cursor.com/api/auth/checkoutDeepControl';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT = 20000;
const STRIPE_CHECKOUT_RE = /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_(live|test)_/;

/** 归一化 token：user_xxx::jwt / %3A%3A → :: */
function normalizeToken(raw: string): string {
  return (raw || '').replace(/%3A%3A/gi, '::').trim();
}

export interface CheckoutSessionResult {
  url: string;
}

@Injectable()
export class CursorCheckoutService {
  private readonly logger = new Logger(CursorCheckoutService.name);

  /**
   * 生成订阅结账链接。返回 { url }。
   * @param cursorToken WorkosCursorSessionToken 值（user_xxx::jwt）
   * @param tier 套餐，默认 pro（月付）
   */
  async createCheckoutSession(
    cursorToken: string,
    tier = 'pro',
  ): Promise<CheckoutSessionResult> {
    const token = normalizeToken(cursorToken);
    if (!token) throw new ServiceUnavailableException('账号缺少 Cursor token，无法生成结账链接');

    let location = '';
    try {
      const resp = await axios.get(CHECKOUT_URL, {
        params: { tier },
        timeout: DEFAULT_TIMEOUT,
        maxRedirects: 0, // 不跟随，直接读 302 的 Location
        validateStatus: (s) => s >= 200 && s < 400,
        headers: {
          Cookie: `WorkosCursorSessionToken=${token}`,
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml',
          Referer: 'https://cursor.com/dashboard',
        },
      });
      location = (resp.headers?.location || (resp.headers as any)?.Location || '') as string;
    } catch (e) {
      // 某些 axios 版本对 3xx + maxRedirects:0 会抛错，错误里仍带 response
      const r = (e as any)?.response;
      if (r?.headers?.location) {
        location = r.headers.location as string;
      } else {
        const msg = (e as Error)?.message || '网络错误';
        this.logger.warn(`checkoutDeepControl failed: ${msg}`);
        throw new ServiceUnavailableException(`调用 Cursor 生成结账链接失败：${msg}`);
      }
    }

    if (STRIPE_CHECKOUT_RE.test(location)) {
      return { url: location };
    }

    this.logger.warn(`checkoutDeepControl no checkout url, redirected to: ${location || '(空)'}`);
    throw new ServiceUnavailableException(
      'Cursor 未返回结账链接：token 可能已失效、账号已是 Pro 或当前不可升级',
    );
  }
}
