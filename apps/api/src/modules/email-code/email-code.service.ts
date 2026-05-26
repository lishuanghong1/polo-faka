import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { createHash, createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptString, isEncrypted } from '../../common/crypto.util';

/**
 * Cursorforge 代理 OpenAPI 接入。
 *
 * 鉴权：HMAC-SHA256 签名（参考 §3 签名算法）
 *   canonical = METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH
 *   signature = hex( hmac_sha256(agent_secret, canonical) )
 *
 * agent_secret 仅服务端用于签名，永远不出现在请求里。
 */

const SETTING_KEYS = [
  'email_code_enabled',
  'email_code_api_base',
  'email_code_agent_key',
  'email_code_agent_secret',
  'email_code_timeout_ms',
];

const DEFAULT_API_BASE = 'https://apiforge.cursorforgeai.top';
const OPENAPI_PATH_PREFIX = '/openapi/v1';

interface EmailCodeConfig {
  baseUrl: string;
  agentKey: string;
  agentSecret: string;
  timeoutMs: number;
}

export interface FetchCodeParams {
  email: string;
  timeRange?: number;
  clearCache?: boolean;
  markRead?: boolean;
  mailId?: string;
}

@Injectable()
export class EmailCodeService {
  private readonly logger = new Logger(EmailCodeService.name);
  private client: AxiosInstance | null = null;
  private snapshot: EmailCodeConfig | null = null;

  constructor(private prisma: PrismaService) {}

  invalidate() {
    this.client = null;
    this.snapshot = null;
  }

  private async loadConfig(): Promise<EmailCodeConfig | null> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) {
      let v = r.value;
      // agent_secret 入库时加密
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
      this.logger.warn('email-code enabled but agentKey/agentSecret missing');
      return null;
    }
    return {
      baseUrl,
      agentKey,
      agentSecret,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
    };
  }

  private async getClient(): Promise<{ client: AxiosInstance; cfg: EmailCodeConfig } | null> {
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
        // 4xx 也要让我们解析 body 拿 code 字段
        validateStatus: (s) => s < 500,
      });
      this.snapshot = cfg;
      this.logger.log(`EmailCode client ready (baseUrl=${cfg.baseUrl}, agentKey=${cfg.agentKey})`);
    }
    return { client: this.client, cfg };
  }

  async isEnabled() {
    const r = await this.getClient();
    return !!r;
  }

  /**
   * 调用三方 /openapi/v1/email-code，单次直通。
   * 前端每 3s 调一次本接口实现轮询。
   */
  async fetchCode(params: FetchCodeParams) {
    const r = await this.getClient();
    if (!r) throw new ServiceUnavailableException('接码接口未启用或配置不完整');

    const email = (params.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }

    const body: Record<string, any> = {
      email,
      time_range: params.timeRange && params.timeRange > 0 ? params.timeRange : 300,
      clear_cache: !!params.clearCache,
      mark_read: !!params.markRead,
      mail_id: params.mailId || '',
    };

    return this.signedRequest(r, 'POST', `${OPENAPI_PATH_PREFIX}/email-code`, body);
  }

  /**
   * 通用签名请求：处理 canonical 拼接、HMAC 签名、错误码透传。
   */
  private async signedRequest(
    ctx: { client: AxiosInstance; cfg: EmailCodeConfig },
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, any>,
  ) {
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
        // 关键：用我们手动拼好的 string 发送，避免 axios 自己再序列化导致 hash 对不上
        data: bodyStr || undefined,
        transformRequest: [(d) => d],
      });
      const data = resp.data || {};
      const code = data.code as string | undefined;
      const message = data.message as string | undefined;
      const requestId = data.request_id as string | undefined;

      if (resp.status >= 400 || (code && code !== 'OK')) {
        this.logger.warn(
          `upstream rejected: status=${resp.status} code=${code} message=${message} request_id=${requestId} raw=${JSON.stringify(data)}`,
        );
        throw new ForbiddenException({
          code: code || 'UPSTREAM_ERROR',
          message: this.friendlyMessage(code, message),
          upstream_message: message,
          request_id: requestId,
        });
      }

      return { code: 'OK', request_id: requestId, ...(data.data || {}) };
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      const err = e as AxiosError<any>;
      if (err.response?.status && err.response.status >= 400 && err.response.status < 500) {
        const body = err.response.data || {};
        this.logger.warn(
          `upstream 4xx: status=${err.response.status} code=${body.code} message=${body.message} request_id=${body.request_id} raw=${JSON.stringify(body)}`,
        );
        throw new ForbiddenException({
          code: body.code || 'UPSTREAM_ERROR',
          message: this.friendlyMessage(body.code, body.message) ||
            `上游错误 (HTTP ${err.response.status})`,
          upstream_message: body.message,
          request_id: body.request_id,
        });
      }
      this.logger.error(`signedRequest error: ${err.message}`);
      throw new ServiceUnavailableException('接码服务暂时不可用，请稍后重试');
    }
  }

  /** 把上游错误码翻译成人话 */
  private friendlyMessage(code?: string, message?: string): string {
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
      FORBIDDEN_SCOPE: '该 API Key 没有 email:code 权限',
      INVALID_PARAM: message || '参数错误',
      EMAIL_NOT_OWNED: '该邮箱不属于本平台代理账号，请确认拼写或确认该号在本平台购买',
      EMAIL_CODE_NOT_ENABLED: message || '该商品类型暂未开放接码功能，请联系客服开通',
      EMAIL_INACTIVE: '账号已不可用（可能已退款 / 已换绑 / 已禁用）',
      EMAIL_EXPIRED: '账号已过期，无法继续接收验证码',
      SERVICE_DISABLED: '接码服务暂时关闭',
      SERVICE_ERROR: '接码上游异常，请稍后重试',
    };
    return map[code] || message || code;
  }
}
