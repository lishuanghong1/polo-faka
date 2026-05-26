import {
  Injectable,
  Logger,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { createHash, createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptString, isEncrypted } from '../../common/crypto.util';

/**
 * Cursorforge 代理 OpenAPI 通用客户端。
 *
 * 鉴权：HMAC-SHA256 签名
 *   canonical = METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH
 *   signature = hex( hmac_sha256(agent_secret, canonical) )
 *
 * 凭证存储：与接码共用 site_settings（email_code_*）；
 * agent_secret 用 AES-GCM 加密入库，运行时解密用于签名，永远不出现在请求体里。
 */

const SETTING_KEYS = [
  'email_code_enabled',
  'email_code_api_base',
  'email_code_agent_key',
  'email_code_agent_secret',
  'email_code_timeout_ms',
];

const DEFAULT_API_BASE = 'https://apiforge.cursorforgeai.top';

export interface ForgeApiConfig {
  baseUrl: string;
  agentKey: string;
  agentSecret: string;
  timeoutMs: number;
}

export class ForgeApiError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    public upstreamMessage: string,
    public requestId?: string,
  ) {
    super(upstreamMessage || code);
  }
}

@Injectable()
export class ForgeOpenapiService {
  private readonly logger = new Logger(ForgeOpenapiService.name);
  private client: AxiosInstance | null = null;
  private snapshot: ForgeApiConfig | null = null;

  constructor(private prisma: PrismaService) {}

  invalidate() {
    this.client = null;
    this.snapshot = null;
  }

  /** env 非空优先；空值/未定义 fallback 到数据库 */
  private async loadConfig(): Promise<ForgeApiConfig | null> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) {
      let v = r.value;
      if (r.key === 'email_code_agent_secret' && isEncrypted(v)) {
        try {
          v = decryptString(v);
        } catch (e) {
          this.logger.error(`decrypt ${r.key} failed: ${(e as Error).message}`);
          v = '';
        }
      }
      map[r.key] = v;
    }

    const pick = (envVal: string | undefined, dbVal: string | undefined): string => {
      const e = (envVal ?? '').trim();
      if (e) return e;
      return (dbVal ?? '').trim();
    };

    const enabledRaw = pick(process.env.EMAIL_CODE_ENABLED, map.email_code_enabled);
    const enabled = enabledRaw === 'true' || enabledRaw === '1';
    if (!enabled) return null;

    const baseUrl = (
      pick(process.env.EMAIL_CODE_API_BASE, map.email_code_api_base) || DEFAULT_API_BASE
    ).replace(/\/+$/, '');
    const agentKey = pick(process.env.EMAIL_CODE_AGENT_KEY, map.email_code_agent_key);
    const agentSecret = pick(process.env.EMAIL_CODE_AGENT_SECRET, map.email_code_agent_secret);
    const timeoutMs = Number(
      pick(process.env.EMAIL_CODE_TIMEOUT_MS, map.email_code_timeout_ms) || '15000',
    );

    if (!agentKey || !agentSecret) {
      this.logger.warn('Forge OpenAPI enabled but agentKey/agentSecret missing');
      return null;
    }
    return {
      baseUrl,
      agentKey,
      agentSecret,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
    };
  }

  private async getClient(): Promise<{ client: AxiosInstance; cfg: ForgeApiConfig } | null> {
    const cfg = await this.loadConfig();
    if (!cfg) {
      this.client = null;
      this.snapshot = null;
      return null;
    }
    if (!this.client || JSON.stringify(this.snapshot) !== JSON.stringify(cfg)) {
      this.client = axios.create({
        baseURL: cfg.baseUrl,
        timeout: cfg.timeoutMs,
        validateStatus: (s) => s < 500,
      });
      this.snapshot = cfg;
      this.logger.log(`Forge OpenAPI client ready (baseUrl=${cfg.baseUrl}, agentKey=${cfg.agentKey})`);
    }
    return { client: this.client, cfg };
  }

  async isEnabled() {
    const r = await this.getClient();
    return !!r;
  }

  /** 把上游错误码翻译成人话（前端可直接展示） */
  static friendlyMessage(code?: string, message?: string): string {
    if (!code) return message || '请求失败';
    const map: Record<string, string> = {
      AUTH_MISSING_HEADERS: '签名头缺失，请检查服务端配置',
      AUTH_BAD_TIMESTAMP: '时间戳格式错误',
      AUTH_BAD_NONCE: 'nonce 长度非法',
      AUTH_TIMESTAMP_EXPIRED: '服务器时间偏差超过 5 分钟，请校准 NTP',
      AUTH_NONCE_REPLAY: 'nonce 已使用，请重试',
      AUTH_KEY_INVALID: 'agent_key 不存在或已禁用',
      AUTH_AGENT_REVOKED: '代理身份已取消',
      AUTH_IP_WHITELIST_REQUIRED: '该 API Key 未配置 IP 白名单，请在 cursorforgeai 代理后台 → 开发者中心 → 编辑 key 配置 IP 白名单',
      AUTH_IP_NOT_ALLOWED: '当前服务器 IP 不在 API Key 的白名单内，请在 cursorforgeai 代理后台添加本服务器出口 IP',
      AUTH_BAD_SIGNATURE: '签名校验失败，请检查 agent_secret 是否正确',
      RATE_LIMIT_EXCEEDED: '调用频率超限，请稍后重试',
      FORBIDDEN_SCOPE: '该 API Key 没有该接口权限',
      INVALID_PARAM: message || '参数错误',
      PRODUCT_NOT_FOUND: '该商品不存在或已下架',
      PRODUCT_NOT_OPENAPI_ENABLED: '该商品类型未对 OpenAPI 开放出货，请联系平台运营',
      INSUFFICIENT_BALANCE: '代理余额不足，请联系平台运营充值',
      OUT_OF_STOCK: '该商品当前缺货',
      PURCHASE_LIMIT: '触发账号类型限购规则',
      CONCURRENT_REQUEST: '同一订单正在处理中，请勿重复提交',
      ORDER_NOT_FOUND: '订单不存在',
      ORDER_FAILED: '上游下单失败，请稍后重试',
      EMAIL_NOT_OWNED: '该邮箱不属于本平台代理账号',
      EMAIL_CODE_NOT_ENABLED: message || '该商品类型暂未开放接码功能',
      EMAIL_INACTIVE: '账号已不可用（可能已退款 / 已换绑 / 已禁用）',
      EMAIL_EXPIRED: '账号已过期',
      SERVICE_DISABLED: '上游服务暂时关闭',
      SERVICE_ERROR: '上游异常，请稍后重试',
    };
    return map[code] || message || code;
  }

  /**
   * 通用签名请求。
   * - 成功（HTTP 2xx + code=OK）：返回 { data, requestId, httpStatus }
   * - 业务错误（HTTP 4xx 或 code !== OK）：抛 ForgeApiError
   * - 网络/超时：抛 ServiceUnavailableException
   */
  async request<T = any>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, any>,
  ): Promise<{ data: T; requestId?: string; httpStatus: number; raw: any }> {
    const ctx = await this.getClient();
    if (!ctx) {
      throw new ServiceUnavailableException('Forge OpenAPI 未启用或配置不完整');
    }
    const { client, cfg } = ctx;

    const bodyStr = body ? JSON.stringify(body) : '';
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const bodyHash = createHash('sha256').update(bodyStr).digest('hex');
    const canonical = `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
    const signature = createHmac('sha256', cfg.agentSecret).update(canonical).digest('hex');

    const headers: Record<string, string> = {
      'X-Agent-Key': cfg.agentKey,
      'X-Agent-Timestamp': ts,
      'X-Agent-Nonce': nonce,
      'X-Agent-Signature': signature,
    };
    if (body) headers['Content-Type'] = 'application/json';

    try {
      const resp = await client.request({
        method,
        url: path,
        headers,
        // 关键：用我们手动拼好的 string 发，避免 axios 二次序列化导致 hash 对不上
        data: bodyStr || undefined,
        transformRequest: [(d) => d],
      });
      const respBody = resp.data || {};
      const code = respBody.code as string | undefined;
      const message = respBody.message as string | undefined;
      const requestId = respBody.request_id as string | undefined;

      if (resp.status >= 400 || (code && code !== 'OK')) {
        this.logger.warn(
          `forge upstream rejected: ${method} ${path} status=${resp.status} code=${code} msg=${message} req_id=${requestId}`,
        );
        throw new ForgeApiError(code || 'UPSTREAM_ERROR', resp.status, message || '', requestId);
      }

      return {
        data: respBody.data as T,
        requestId,
        httpStatus: resp.status,
        raw: respBody,
      };
    } catch (e) {
      if (e instanceof ForgeApiError) throw e;
      const err = e as AxiosError<any>;
      if (err.response?.status && err.response.status < 500) {
        const body = err.response.data || {};
        this.logger.warn(
          `forge upstream 4xx: ${method} ${path} status=${err.response.status} code=${body.code} msg=${body.message}`,
        );
        throw new ForgeApiError(
          body.code || 'UPSTREAM_ERROR',
          err.response.status,
          body.message || `上游错误 (HTTP ${err.response.status})`,
          body.request_id,
        );
      }
      this.logger.error(`forge upstream network error: ${method} ${path} ${err.message}`);
      throw new ServiceUnavailableException('上游服务暂时不可用，请稍后重试');
    }
  }

  /**
   * 把 ForgeApiError 转为 Nest 的 ForbiddenException（含友好提示），
   * 用于 controller 层把上游错误统一暴露给前端。
   */
  static toHttpException(e: unknown): ForbiddenException | ServiceUnavailableException {
    if (e instanceof ForgeApiError) {
      return new ForbiddenException({
        code: e.code,
        message: ForgeOpenapiService.friendlyMessage(e.code, e.upstreamMessage),
        upstream_message: e.upstreamMessage,
        request_id: e.requestId,
      });
    }
    if (e instanceof ServiceUnavailableException) return e;
    return new ServiceUnavailableException(
      (e as Error)?.message || '上游服务暂时不可用，请稍后重试',
    );
  }
}
