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

/**
 * Cursor 成品号购买 API（cursor.zhangyuwang.cn/api/open/sell）客户端。
 *
 * 鉴权：请求头 `Authorization: Bearer <API_KEY>`；
 * 响应统一为 `{ ok: true, data }` / `{ ok: false, error_code, error }`；
 * 金额单位一律「人民币分」。
 *
 * 目前只用到「兑换充值卡」（前台 Team 兑换）与「查余额」（后台校验配置）。
 * API Key 用 AES-GCM 加密存于 site_settings，永远不下发到浏览器。
 */

const SETTING_KEYS = ['cursor_sell_enabled', 'cursor_sell_api_base', 'cursor_sell_api_key'];

const DEFAULT_API_BASE = 'https://cursor.zhangyuwang.cn/api/open/sell';

export interface CursorSellConfig {
  baseUrl: string;
  apiKey: string;
}

export interface WalletRedeemResult {
  amountCents: number;
  balanceCents: number;
  /** 上游若按商品配置额外返回了字段（如凭据），原样保留 */
  [key: string]: unknown;
}

/** 这些错误码说明是本站的渠道凭证/配置有问题，不应把上游原文直接暴露给终端用户 */
const CONFIG_ERROR_CODES = new Set(['NO_KEY', 'INVALID_KEY', 'FORBIDDEN', 'KEY_NOT_BOUND']);

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

  private static friendlyMessage(code: string, message: string): string {
    if (CONFIG_ERROR_CODES.has(code)) {
      return 'Team 兑换渠道暂不可用（渠道凭证无效或无权限），请联系客服';
    }
    if (code === 'UPSTREAM_UNAVAILABLE') return '上游暂时无法确认状态，请稍后重试';
    // 上游的 error 本身就是中文说明（如「充值卡不存在」），优先透传
    return message || code || '请求失败';
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

  private async loadConfig(): Promise<CursorSellConfig | null> {
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

    const baseUrl = ((map.cursor_sell_api_base ?? '').trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
    const apiKey = (map.cursor_sell_api_key ?? '').trim();
    if (!apiKey) {
      this.logger.warn('Cursor Sell enabled but apiKey missing');
      return null;
    }
    return { baseUrl, apiKey };
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
        timeout: 30_000,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        // 4xx 由业务层按 error_code 处理；5xx / 网络错误走 catch
        validateStatus: (s) => s < 500,
      });
      this.snapshot = cfg;
      this.logger.log(
        `Cursor Sell client ready (baseUrl=${cfg.baseUrl}, apiKey=${maskSecret(cfg.apiKey)})`,
      );
    }
    return { client: this.client, cfg };
  }

  async isEnabled(): Promise<boolean> {
    return !!(await this.getClient());
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const ctx = await this.getClient();
    if (!ctx) {
      throw new ServiceUnavailableException('Team 兑换渠道未启用或配置不完整');
    }
    try {
      const resp = await ctx.client.request({ method, url: path, data: body });
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
      throw new ServiceUnavailableException('Team 兑换渠道暂时不可用，请稍后重试');
    }
  }

  // ====== 业务方法 ======

  /** 接口 3：兑换充值卡到售号钱包 */
  async redeemWalletCard(code: string): Promise<WalletRedeemResult> {
    return this.request<WalletRedeemResult>('POST', '/wallet/redeem', { code });
  }

  /** 接口 2：查售号钱包余额（后台校验 API Key 用） */
  async getWallet(): Promise<{ balanceCents: number }> {
    return this.request<{ balanceCents: number }>('GET', '/wallet');
  }
}
