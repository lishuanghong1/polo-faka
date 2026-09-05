import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptString, isEncrypted, maskSecret } from '../../common/crypto.util';
import {
  UpstreamAccountSale,
  UpstreamBuyResult,
  UpstreamExtractCard,
  UpstreamOrderSummary,
  UpstreamProduct,
} from './cursor-sell.types';

/**
 * Cursor 成品号购买 API（cursor.zhangyuwang.cn/api/open/sell）HTTP 客户端。
 *
 * - 鉴权：`Authorization: Bearer <API_KEY>`。Key 可选：未配置时不带该头（兑换充值卡允许匿名），
 *   其余接口上游会返回 NO_KEY。
 * - 响应统一 `{ ok: true, data }` / `{ ok: false, error_code, error }`；金额单位「分」。
 * - 买号必须带 Idempotency-Key：同一 Key + 同一商品重试返回同一笔成交，绝不重复扣费。
 *
 * 这里只负责「发请求 + 错误翻译」，采购/发货/落库逻辑在 CursorSellFulfilService。
 */

const SETTING_KEYS = [
  'cursor_sell_enabled',
  'cursor_sell_api_base',
  'cursor_sell_api_key',
  'cursor_sell_low_balance_yuan',
];

export const CURSOR_SELL_DEFAULT_API_BASE = 'https://cursor.zhangyuwang.cn/api/open/sell';

export interface CursorSellConfig {
  baseUrl: string;
  /** 可为空串：表示匿名调用 */
  apiKey: string;
  /** 低余额提醒阈值（分），0 = 关闭 */
  lowBalanceCents: number;
}

/** 本站渠道凭证/配置问题：不把上游原文暴露给终端用户 */
const CONFIG_ERROR_CODES = new Set(['NO_KEY', 'INVALID_KEY', 'FORBIDDEN', 'KEY_NOT_BOUND']);

/** 上游明确说「未扣费，可用同一幂等键重试」的错误，以及库存类可稍后再试的错误 */
export const RETRYABLE_ERROR_CODES = new Set(['UPSTREAM_UNAVAILABLE', 'OUT_OF_STOCK']);

export class CursorSellApiError extends HttpException {
  constructor(
    public readonly errorCode: string,
    public readonly upstreamMessage: string,
    public readonly upstreamStatus: number,
  ) {
    super(
      CursorSellApiError.friendlyMessage(errorCode, upstreamMessage),
      CursorSellApiError.mapStatus(errorCode, upstreamStatus),
    );
  }

  get isConfigError() {
    return CONFIG_ERROR_CODES.has(this.errorCode);
  }

  get isRetryable() {
    return RETRYABLE_ERROR_CODES.has(this.errorCode);
  }

  static friendlyMessage(code: string, message: string): string {
    if (CONFIG_ERROR_CODES.has(code)) {
      return 'Team 渠道暂不可用（渠道凭证无效或无权限），请联系客服';
    }
    const map: Record<string, string> = {
      IDEMPOTENCY_REQUIRED: '渠道请求缺少幂等键（程序错误）',
      IDEMPOTENCY_CONFLICT: '幂等键已用于其它商品（程序错误）',
      NO_SALES_WALLET: '渠道尚无售号钱包，请先兑换充值卡',
      INSUFFICIENT_BALANCE: '渠道余额不足，请先充值',
      PRODUCT_NOT_FOUND: '渠道商品不存在，请重新同步商品',
      PRODUCT_DISABLED: '渠道商品已下架',
      OUT_OF_STOCK: '渠道暂无可售库存，请稍后再试',
      UPSTREAM_UNAVAILABLE: '账号状态暂无法确认，未扣费，请稍后重试',
      ORDER_NOT_FOUND: '渠道订单不存在',
    };
    return map[code] || message || code || '请求失败';
  }

  private static mapStatus(code: string, upstreamStatus: number): number {
    if (CONFIG_ERROR_CODES.has(code)) return HttpStatus.SERVICE_UNAVAILABLE;
    if (upstreamStatus >= 400 && upstreamStatus < 500) return upstreamStatus;
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
}

@Injectable()
export class CursorSellService {
  private readonly logger = new Logger(CursorSellService.name);
  private client: AxiosInstance | null = null;
  private snapshot: CursorSellConfig | null = null;

  constructor(private prisma: PrismaService) {}

  invalidate() {
    this.client = null;
    this.snapshot = null;
  }

  async loadConfig(): Promise<CursorSellConfig | null> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) {
      let v = r.value;
      if (r.key === 'cursor_sell_api_key' && isEncrypted(v)) {
        try {
          v = decryptString(v);
        } catch (e) {
          this.logger.error(`decrypt ${r.key} failed: ${(e as Error).message}`);
          v = '';
        }
      }
      map[r.key] = v;
    }

    const enabledRaw = (map.cursor_sell_enabled ?? '').trim();
    if (enabledRaw !== 'true' && enabledRaw !== '1') return null;

    const baseUrl = ((map.cursor_sell_api_base ?? '').trim() || CURSOR_SELL_DEFAULT_API_BASE).replace(/\/+$/, '');
    const apiKey = (map.cursor_sell_api_key ?? '').trim();
    const lowYuan = Number((map.cursor_sell_low_balance_yuan ?? '').trim());
    const lowBalanceCents = Number.isFinite(lowYuan) && lowYuan > 0 ? Math.round(lowYuan * 100) : 0;
    return { baseUrl, apiKey, lowBalanceCents };
  }

  private async getClient(): Promise<{ client: AxiosInstance; cfg: CursorSellConfig } | null> {
    const cfg = await this.loadConfig();
    if (!cfg) {
      this.client = null;
      this.snapshot = null;
      return null;
    }
    if (!this.client || JSON.stringify(this.snapshot) !== JSON.stringify(cfg)) {
      this.client = axios.create({
        baseURL: cfg.baseUrl,
        timeout: 45_000,
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        // 4xx 由业务层按 error_code 处理；5xx / 网络错误走 catch
        validateStatus: (s) => s < 500,
      });
      this.snapshot = cfg;
      this.logger.log(
        `Cursor Sell client ready (baseUrl=${cfg.baseUrl}, apiKey=${cfg.apiKey ? maskSecret(cfg.apiKey) : '<none>'})`,
      );
    }
    return { client: this.client, cfg };
  }

  async isEnabled(): Promise<boolean> {
    return !!(await this.getClient());
  }

  /** 是否配置了 API Key（除兑换充值卡外的接口都需要） */
  async hasApiKey(): Promise<boolean> {
    const cfg = await this.loadConfig();
    return !!cfg?.apiKey;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const ctx = await this.getClient();
    if (!ctx) {
      throw new ServiceUnavailableException('Team 渠道未启用或配置不完整');
    }
    try {
      const resp = await ctx.client.request({ method, url: path, data: body, headers: extraHeaders });
      const payload = (resp.data ?? {}) as {
        ok?: boolean;
        data?: T;
        error_code?: string;
        error?: string;
      };
      if (resp.status >= 400 || payload.ok !== true) {
        const code = payload.error_code || `HTTP_${resp.status}`;
        const message = payload.error || '';
        this.logger.warn(
          `cursor-sell ${method} ${path} rejected: status=${resp.status} code=${code} msg=${message}`,
        );
        throw new CursorSellApiError(code, message, resp.status);
      }
      return payload.data as T;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const err = e as { code?: string; message?: string; response?: { status?: number } };
      const detail = `${err.code || (err.response?.status ? `HTTP_${err.response.status}` : 'UNKNOWN')} ${err.message || ''}`.trim();
      this.logger.error(`cursor-sell ${method} ${path} network error: ${detail}`);
      throw new CursorSellNetworkError(detail);
    }
  }

  // ====== 接口 1：列商品 ======
  async listProducts(): Promise<UpstreamProduct[]> {
    const data = await this.request<UpstreamProduct[]>('GET', '/products');
    return Array.isArray(data) ? data : [];
  }

  // ====== 接口 2：查余额 ======
  async getWallet(): Promise<{ balanceCents: number }> {
    return this.request<{ balanceCents: number }>('GET', '/wallet');
  }

  // ====== 接口 3：兑换充值卡 ======
  async redeemWalletCard(code: string): Promise<{ amountCents: number; balanceCents: number }> {
    return this.request('POST', '/wallet/redeem', { code });
  }

  // ====== 接口 4：买号（必须带 Idempotency-Key） ======
  async buyAccount(
    input: { code: string; qty?: number; extractSplit?: boolean },
    idempotencyKey: string,
  ): Promise<UpstreamBuyResult> {
    const body: Record<string, unknown> = { code: input.code };
    if (input.qty && input.qty > 1) body.qty = input.qty;
    if (typeof input.extractSplit === 'boolean') body.extractSplit = input.extractSplit;
    return this.request<UpstreamBuyResult>('POST', '/buy-account', body, {
      'Idempotency-Key': idempotencyKey,
    });
  }

  // ====== 接口 5：订单查询 ======
  async listOrders(): Promise<UpstreamOrderSummary[]> {
    const data = await this.request<UpstreamOrderSummary[] | { items?: UpstreamOrderSummary[] }>('GET', '/orders');
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.items) ? data.items : [];
  }

  async getOrder(saleId: number): Promise<UpstreamAccountSale> {
    return this.request<UpstreamAccountSale>('GET', `/orders/${saleId}`);
  }

  // ====== 接口 6：我的提取卡密（完整明文） ======
  async listExtractCards(paymentOrderNo?: string): Promise<UpstreamExtractCard[]> {
    const qs = paymentOrderNo ? `?paymentOrderNo=${encodeURIComponent(paymentOrderNo)}` : '';
    const data = await this.request<UpstreamExtractCard[] | { items?: UpstreamExtractCard[] }>(
      'GET',
      `/extract-cards${qs}`,
    );
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.items) ? data.items : [];
  }

  // ====== 接口 7：授权登录 / 额度 / 教程 ======
  async loginApprove(saleId: number, loginUrl: string): Promise<{ approved: boolean }> {
    return this.request('POST', `/orders/${saleId}/login-approve`, { loginUrl });
  }

  async getUsage(saleId: number): Promise<Record<string, unknown>> {
    return this.request('GET', `/orders/${saleId}/usage`);
  }

  async getLoginTutorial(saleId: number): Promise<Record<string, unknown> | string> {
    return this.request('GET', `/orders/${saleId}/login-tutorial`);
  }
}

/** 网络层错误（DNS / 超时 / 5xx）：对用户固定文案，detail 留给日志和采购单 failReason */
export class CursorSellNetworkError extends ServiceUnavailableException {
  constructor(public readonly detail: string) {
    super('Team 渠道暂时不可用，请稍后重试');
  }
}
