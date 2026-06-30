import { Injectable, Logger, ServiceUnavailableException, BadRequestException, NotFoundException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptString, isEncrypted } from '../../common/crypto.util';

const SETTING_KEYS = [
  'aizhp_open_enabled',
  'aizhp_open_api_base',
  'aizhp_open_api_key',
];

const DEFAULT_API_BASE = 'https://account.aizhp.site';

export interface AizhpOpenConfig {
  baseUrl: string;
  apiKey: string;
}

export class AizhpApiError extends Error {
  constructor(
    public httpStatus: number,
    public detail: string,
  ) {
    super(detail);
  }
}

@Injectable()
export class AizhpOpenService {
  private readonly logger = new Logger(AizhpOpenService.name);
  private client: AxiosInstance | null = null;
  private snapshot: AizhpOpenConfig | null = null;

  constructor(private prisma: PrismaService) {}

  invalidate() {
    this.client = null;
    this.snapshot = null;
  }

  private async loadConfig(): Promise<AizhpOpenConfig | null> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) {
      let v = r.value;
      if (r.key === 'aizhp_open_api_key' && isEncrypted(v)) {
        try {
          v = decryptString(v);
        } catch (e) {
          this.logger.error(`decrypt ${r.key} failed: ${(e as Error).message}`);
          v = '';
        }
      }
      map[r.key] = v;
    }

    const enabledRaw = (map.aizhp_open_enabled ?? '').trim();
    const enabled = enabledRaw === 'true' || enabledRaw === '1';
    if (!enabled) return null;

    const baseUrl = (map.aizhp_open_api_base || DEFAULT_API_BASE).replace(/\/+$/, '');
    const apiKey = (map.aizhp_open_api_key || '').trim();

    if (!apiKey) {
      this.logger.warn('Aizhp Open enabled but apiKey missing');
      return null;
    }
    return { baseUrl, apiKey };
  }

  private async getClient(): Promise<{ client: AxiosInstance; cfg: AizhpOpenConfig } | null> {
    const cfg = await this.loadConfig();
    if (!cfg) {
      this.client = null;
      this.snapshot = null;
      return null;
    }
    if (!this.client || JSON.stringify(this.snapshot) !== JSON.stringify(cfg)) {
      this.client = axios.create({
        baseURL: cfg.baseUrl,
        timeout: 15000,
        headers: { 'X-User-API-Key': cfg.apiKey },
        validateStatus: (s) => s < 500,
      });
      this.snapshot = cfg;
      this.logger.log(`Aizhp Open client ready (baseUrl=${cfg.baseUrl})`);
    }
    return { client: this.client, cfg };
  }

  async isEnabled(): Promise<boolean> {
    const r = await this.getClient();
    return !!r;
  }

  private async request<T = any>(method: 'GET' | 'POST', path: string, data?: any): Promise<T> {
    const ctx = await this.getClient();
    if (!ctx) {
      throw new ServiceUnavailableException('Aizhp Open 渠道未启用或配置不完整');
    }
    try {
      const resp = await ctx.client.request({ method, url: path, data });
      if (resp.status >= 400) {
        const msg = resp.data?.error || resp.data?.message || `HTTP ${resp.status}`;
        this.logger.warn(`aizhp-open ${method} ${path} → ${resp.status}: ${msg}`);
        throw new AizhpApiError(resp.status, msg);
      }
      return resp.data as T;
    } catch (e) {
      if (e instanceof AizhpApiError) throw e;
      if (e instanceof ServiceUnavailableException) throw e;
      const err = e as any;
      const detail = err?.message || 'network error';
      this.logger.error(`aizhp-open ${method} ${path} network error: ${detail}`);
      throw new ServiceUnavailableException('Aizhp 渠道服务暂不可用，请稍后重试');
    }
  }

  // ====== 业务方法 ======

  /** 校验 API Key 有效性 */
  async ping() {
    return this.request<{ success: boolean; username: string; caps: string[] }>('GET', '/uopen/v1/ping');
  }

  /** 分页列出账号 */
  async listAccounts(filter: 'all' | 'used' | 'unused' = 'all', page = 1, pageSize = 20) {
    return this.request<{
      success: boolean;
      accounts: { id: number; email: string; group_name: string; used: boolean }[];
      total: number;
      page: number;
      page_size: number;
    }>('GET', `/uopen/v1/accounts?filter=${filter}&page=${page}&page_size=${pageSize}`);
  }

  /** 获取一个 unused 账号（发货用） */
  async fetchUnusedAccount(): Promise<{ id: number; email: string; group_name: string } | null> {
    const resp = await this.listAccounts('unused', 1, 1);
    if (!resp.success || !resp.accounts?.length) return null;
    return resp.accounts[0];
  }

  /** 从账号邮箱提取验证码 */
  async fetchCode(email: string, since?: number) {
    const body: Record<string, any> = { email };
    if (since) body.since = since;
    return this.request<{ success: boolean; code?: string; error?: string }>('POST', '/uopen/v1/accounts/code', body);
  }

  /** 查询退款额度 */
  async getQuotas() {
    return this.request<{
      success: boolean;
      is_super: boolean;
      quotas: { plan: string; plan_label: string; refund_method: string; balance: number | null }[];
    }>('GET', '/uopen/v1/quotas');
  }

  /** 发起退款 */
  async submitRefund(email: string, plan: string, refundMethod?: string) {
    const body: Record<string, any> = { email, plan };
    if (refundMethod) body.refund_method = refundMethod;
    return this.request<{
      success: boolean;
      refund_id: number;
      message: string;
      plan: string;
      remaining_quota: string;
    }>('POST', '/uopen/v1/refund', body);
  }

  /** 查单条退款结果 */
  async getRefund(id: number) {
    return this.request<{
      success: boolean;
      refund: { id: number; account_email: string; status: string };
    }>('GET', `/uopen/v1/refunds/${id}`);
  }

  /** 列出退款记录（原始上游数据） */
  async listRefunds(page = 1, pageSize = 20) {
    return this.request<{
      success: boolean;
      refunds: { id: number; account_email: string; subscription_plan: string; status: string }[];
      total: number;
      page: number;
      page_size: number;
    }>('GET', `/uopen/v1/refunds?page=${page}&page_size=${pageSize}`);
  }

  /** 列出退款记录（增强版：关联本地订单号） */
  async listRefundsEnriched(page = 1, pageSize = 20) {
    const upstream = await this.listRefunds(page, pageSize);
    if (!upstream.success || !upstream.refunds?.length) return upstream;

    // 用邮箱批量查本地卡密表，找到对应订单号
    const emails = upstream.refunds.map((r) => r.account_email.toLowerCase());
    const cardKeys = await this.prisma.cardKey.findMany({
      where: {
        content: { in: emails },
        remark: { startsWith: '[aizhp' },
      },
      select: { content: true, orderNo: true, soldAt: true },
      orderBy: { id: 'desc' },
    });
    // 构建 email -> orderNo 映射（取最新一条）
    const emailToOrder = new Map<string, { orderNo: string | null; soldAt: Date | null }>();
    for (const ck of cardKeys) {
      const key = (ck.content || '').toLowerCase();
      if (!emailToOrder.has(key)) {
        emailToOrder.set(key, { orderNo: ck.orderNo, soldAt: ck.soldAt });
      }
    }

    const enriched = upstream.refunds.map((r) => {
      const local = emailToOrder.get(r.account_email.toLowerCase());
      return {
        ...r,
        orderNo: local?.orderNo || null,
        soldAt: local?.soldAt || null,
      };
    });

    return { ...upstream, refunds: enriched };
  }

  // ====== 前台用户自助退款 ======

  /**
   * 前台用户申请退款：校验邮箱是否属于本站 AIZHP 渠道售出的账号，自动识别档位，然后调用退款 API。
   */
  async userRefund(email: string, planOverride?: string) {
    const emailLower = (email || '').trim().toLowerCase();
    if (!emailLower) throw new BadRequestException('请填写邮箱');

    // 校验：邮箱必须对应一条 [aizhp] 标记且已售出的卡密
    const cardKey = await this.prisma.cardKey.findFirst({
      where: { content: emailLower, remark: { startsWith: '[aizhp' }, status: 'SOLD' },
      orderBy: { id: 'desc' },
    });
    if (!cardKey) {
      throw new NotFoundException('没有找到该邮箱对应的账号，请确认是在本站购买的 Aizhp 渠道账号');
    }

    // 从 remark 中自动提取档位：[aizhp:pro] / [aizhp:pro+] / [aizhp:ultra]
    let plan = planOverride || 'pro';
    const match = (cardKey.remark || '').match(/\[aizhp:([^\]]+)\]/);
    if (match && match[1]) {
      plan = match[1].trim();
    }

    // 调用退款 API
    const result = await this.submitRefund(emailLower, plan);

    // 将 refund_id 写入卡密 remark 以便订单详情页查询状态
    if (result.refund_id) {
      const newRemark = (cardKey.remark || '').replace(/ refund=\d+/, '') + ` refund=${result.refund_id}`;
      await this.prisma.cardKey.update({
        where: { id: cardKey.id },
        data: { remark: newRemark },
      });
    }

    return result;
  }

  /** 根据 refund_id 查询退款状态（供订单详情页使用） */
  async getRefundStatus(refundId: number): Promise<{ id: number; status: string; account_email?: string } | null> {
    try {
      const resp = await this.request<{
        success: boolean;
        refund: { id: number; account_email: string; status: string };
      }>('GET', `/uopen/v1/refunds/${refundId}`);
      return resp.refund || null;
    } catch {
      return null;
    }
  }
}
