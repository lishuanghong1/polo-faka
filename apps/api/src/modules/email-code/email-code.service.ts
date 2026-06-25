import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { ForgeApiError, ForgeOpenapiService } from '../forge-openapi/forge-openapi.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 仓库账号在线接码：调 aizhp 接码网关（POST /open/v1/extract）。
 * 新接口只需邮箱（无需邮箱密码），由网关侧根据 rule 提取验证码。
 * URL / Key 可用环境变量覆盖，未配置时回退到默认值。
 */
const AIZHP_EXTRACT_URL =
  process.env.AIZHP_EXTRACT_URL || 'https://account.aizhp.site/open/v1/extract';
const AIZHP_API_KEY =
  process.env.AIZHP_API_KEY || 'NU_W53icsmhebAMzRsqWZXE2hdXlLDBGO5w9Y8_fp8k';
const AIZHP_RULE = process.env.AIZHP_RULE || 'cursor';
// 每次轮询让网关侧最多等待的秒数（需小于前端 axios 15s 超时）
const AIZHP_WAIT_SECONDS = 8;
const WAREHOUSE_SEPARATOR = '----';

export interface FetchCodeParams {
  email: string;
  timeRange?: number;
  clearCache?: boolean;
  markRead?: boolean;
  mailId?: string;
}

/**
 * 接码错误友好化映射。
 * - message：给用户看的主提示（友好、不吓人）
 * - hint：操作建议（次要灰字）
 * - terminal：是否应停止轮询（true=终止，false=可继续自动重试）
 */
interface FriendlyError {
  message: string;
  hint?: string;
  terminal: boolean;
}

const EMAIL_CODE_ERROR_MAP: Record<string, FriendlyError> = {
  EMAIL_NOT_OWNED: {
    message: '没有找到这个邮箱对应的账号',
    hint: '请检查邮箱是否输入正确。只有在本站购买的账号才能在线接码。',
    terminal: true,
  },
  EMAIL_INACTIVE: {
    message: '该账号暂时无法接收验证码',
    hint: '账号可能已退款、已换绑或已停用。若是刚购买的账号，请联系客服核实。',
    terminal: true,
  },
  EMAIL_EXPIRED: {
    message: '该账号已过期',
    hint: '账号的有效期已结束，无法再接收验证码，如需继续使用请重新购买。',
    terminal: true,
  },
  EMAIL_CODE_NOT_ENABLED: {
    message: '该账号类型暂不支持在线接码',
    hint: '这类商品未开放接码功能，如有疑问请联系客服。',
    terminal: true,
  },
  RATE_LIMIT_EXCEEDED: {
    message: '获取有点频繁，正在自动放慢重试',
    hint: '请稍候，系统会继续帮你尝试获取验证码。',
    terminal: false,
  },
  CONCURRENT_REQUEST: {
    message: '正在处理上一条请求，请稍候',
    hint: '系统会自动继续尝试。',
    terminal: false,
  },
  SERVICE_DISABLED: {
    message: '接码服务暂时维护中',
    hint: '上游服务正在维护，请稍后再来试试。',
    terminal: true,
  },
  SERVICE_ERROR: {
    message: '服务有点繁忙，正在重试',
    hint: '上游暂时不稳定，系统会继续尝试。',
    terminal: false,
  },
};

/** 配置 / 鉴权类错误：属于服务端问题，不向终端用户暴露技术细节 */
const CONFIG_ERROR: FriendlyError = {
  message: '接码服务暂时不可用',
  hint: '系统正在排查，请稍后再试，或联系客服处理。',
  terminal: true,
};

@Injectable()
export class EmailCodeService {
  private readonly logger = new Logger(EmailCodeService.name);

  constructor(
    private readonly forge: ForgeOpenapiService,
    private readonly prisma: PrismaService,
  ) {}

  /** site-settings 改动后调用 */
  invalidate() {
    this.forge.invalidate();
  }

  async isEnabled() {
    // forge 接码启用，或仓库里有账号（仓库邮箱走 toolsvip）时，均视为可用
    if (await this.forge.isEnabled()) return true;
    try {
      const count = await this.prisma.warehouseAccount.count();
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * 在仓库里按邮箱找到对应账号，返回 content 里的「原始大小写邮箱」。
   * content = email----emailpwd----cursorpwd----token。
   * 找不到返回 null（说明不是仓库邮箱，走原 forge 逻辑）。
   *
   * 新接码网关只需邮箱（无需密码），但仍只放行「本站仓库里存在」的邮箱，
   * 避免 API Key 被用来给任意邮箱接码。邮箱可能大小写敏感，故返回原始大小写。
   */
  private async resolveWarehouseEmail(emailLower: string): Promise<string | null> {
    let content: string | null = null;
    try {
      const byEmail = await this.prisma.warehouseAccount.findFirst({
        where: { email: emailLower },
        orderBy: { id: 'desc' },
      });
      content = byEmail?.content ?? null;
      if (byEmail && !content) return byEmail.email || emailLower;
      if (!content) {
        const byContent = await this.prisma.warehouseAccount.findFirst({
          where: { content: { startsWith: emailLower } },
          orderBy: { id: 'desc' },
        });
        content = byContent?.content ?? null;
      }
      // 兜底：扫描全部账号按 content 第一段 / email 字段做大小写无关匹配
      if (!content) {
        const all = await this.prisma.warehouseAccount.findMany({
          select: { content: true, email: true },
          take: 5000,
        });
        const hit = all.find((r) => {
          const e0 = (r.content || '').split(WAREHOUSE_SEPARATOR)[0]?.trim().toLowerCase();
          return e0 === emailLower || (r.email || '').trim().toLowerCase() === emailLower;
        });
        if (hit) {
          const e0 = (hit.content || '').split(WAREHOUSE_SEPARATOR)[0]?.trim();
          return e0 || hit.email || emailLower;
        }
      }
    } catch (e) {
      this.logger.warn(`resolveWarehouseEmail failed: ${(e as Error)?.message}`);
      return null;
    }
    if (!content) return null;
    const origEmail = content.split(WAREHOUSE_SEPARATOR)[0]?.trim();
    return origEmail || emailLower;
  }

  /** 从 aizhp 返回体里提取 4-8 位验证码（兼容多种字段命名） */
  private extractAizhpCode(data: any): string | null {
    if (data == null) return null;
    const pick = (v: any): string | null => {
      if (typeof v === 'number' && Number.isInteger(v)) {
        const s = String(v);
        return /^\d{4,8}$/.test(s) ? s : null;
      }
      if (typeof v === 'string') {
        const t = v.trim();
        if (/^\d{4,8}$/.test(t)) return t;
        const m = t.match(/(?<!\d)(\d{4,8})(?!\d)/);
        if (m) return m[1];
      }
      return null;
    };
    // 常见承载字段优先
    const candidates = [
      data.verification_code,
      data.data?.verification_code,
      data.code,
      data.data?.code,
      data.result,
      data.data?.result,
      data.otp,
      data.data,
    ];
    for (const c of candidates) {
      const hit = pick(c);
      if (hit) return hit;
    }
    // 兜底：从正文文本里抓
    for (const c of [data.text, data.data?.text, data.message]) {
      const hit = pick(c);
      if (hit) return hit;
    }
    return null;
  }

  /** aizhp 业务错误（success=false）→ 友好结构 */
  private describeAizhpError(errText?: string): FriendlyError {
    const raw = errText || '';
    if (raw.includes('不存在')) {
      return {
        message: '没有找到这个邮箱对应的账号',
        hint: '请确认邮箱与购买的账号一致；若确为本站账号请联系客服核实。',
        terminal: true,
      };
    }
    if (raw.includes('过期') || raw.includes('失效') || raw.includes('有效期')) {
      return {
        message: '该账号已过期或失效',
        hint: '账号有效期已结束，如需继续使用请重新购买。',
        terminal: true,
      };
    }
    if (raw.includes('频繁') || raw.includes('限流') || raw.toLowerCase().includes('rate')) {
      return {
        message: '获取有点频繁，正在自动放慢重试',
        hint: '请稍候，系统会继续帮你尝试获取验证码。',
        terminal: false,
      };
    }
    if (raw.toLowerCase().includes('api key') || raw.includes('鉴权') || raw.includes('未授权')) {
      return CONFIG_ERROR;
    }
    // 其余（如"未收到验证码"/"超时"等）当作还没收到 → 继续轮询
    return { message: '正在查收邮件…', hint: '', terminal: false };
  }

  /**
   * 调 aizhp 接码网关。返回 { found, verification_code?, mail_time?, terminal?, message?, hint?, debug }。
   * 网关侧会等待最多 waitSeconds 秒，故 axios 超时设为 waitSeconds + 余量。
   */
  private async fetchFromAizhp(email: string, waitSeconds: number) {
    let data: any;
    try {
      const resp = await axios.post(
        AIZHP_EXTRACT_URL,
        { email, rule: AIZHP_RULE, timeout: waitSeconds },
        {
          headers: { 'Content-Type': 'application/json', 'X-API-Key': AIZHP_API_KEY },
          timeout: (waitSeconds + 6) * 1000,
          // 4xx 也拿到响应体（邮箱不存在 / API Key 无效都走这里）
          validateStatus: () => true,
        },
      );
      data = resp.data;
    } catch (e: any) {
      // 网络 / 超时：可继续重试
      this.logger.warn(`aizhp http error: ${e?.message}`);
      return {
        found: false,
        terminal: false,
        message: '网络不稳定，正在重试',
        hint: '正在尝试重新连接接码服务。',
        debug: { networkError: String(e?.message || '') },
      };
    }

    if (data && typeof data === 'object' && data.success) {
      const code = this.extractAizhpCode(data);
      if (code) {
        const dateStr = data.date || data.data?.date;
        const mailTime = dateStr ? Math.floor(Date.parse(dateStr) / 1000) : undefined;
        return {
          found: true,
          verification_code: code,
          mail_time: Number.isFinite(mailTime) ? mailTime : undefined,
        };
      }
      // success 但没解析到码 → 还没收到，继续轮询
      let sample = '';
      try {
        sample = JSON.stringify(data).slice(0, 200);
      } catch {
        sample = '<unserializable>';
      }
      return { found: false, terminal: false, message: '正在查收邮件…', debug: { sample } };
    }

    // success=false / 非预期结构 → 翻译错误
    const errText = (data && typeof data === 'object' ? data.error : undefined) as string | undefined;
    const friendly = this.describeAizhpError(errText);
    if (!errText) this.logger.warn(`aizhp unexpected body for ${email}`);
    return {
      found: false,
      terminal: friendly.terminal,
      message: friendly.message,
      hint: friendly.hint,
      debug: { error: errText },
    };
  }

  /** 把上游错误码翻译成友好结构（接码场景专用） */
  private describeError(code?: string): FriendlyError {
    if (!code) {
      return { message: '获取失败，正在重试', hint: '请稍候。', terminal: false };
    }
    if (EMAIL_CODE_ERROR_MAP[code]) return EMAIL_CODE_ERROR_MAP[code];
    // AUTH_* / FORBIDDEN_SCOPE / PRODUCT_* / INVALID_PARAM 等：统一当配置/服务端问题
    if (
      code.startsWith('AUTH_') ||
      code === 'FORBIDDEN_SCOPE' ||
      code.startsWith('PRODUCT_') ||
      code === 'INVALID_PARAM'
    ) {
      return CONFIG_ERROR;
    }
    return { message: '获取失败，正在重试', hint: '系统会继续尝试。', terminal: false };
  }

  /**
   * 调用三方 POST /openapi/v1/email-code，单次直通。
   * 前端每 3s 调一次本接口实现轮询。
   *
   * 注意：本接口对「业务错误」一律返回 HTTP 200 + 结构化结果（不再抛 403），
   * 由前端根据 ok / terminal 决定提示文案与是否停止轮询，避免控制台噪声与吓人的报错。
   */
  async fetchCode(params: FetchCodeParams) {
    const email = (params.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }

    const timeRange = params.timeRange && params.timeRange > 0 ? params.timeRange : 300;

    // 仓库邮箱：用 content 里的「原始大小写邮箱」调 aizhp 接码网关（无需邮箱密码）
    const warehouseEmail = await this.resolveWarehouseEmail(email);
    if (warehouseEmail) {
      const r = await this.fetchFromAizhp(warehouseEmail, AIZHP_WAIT_SECONDS);
      if (r.found) {
        return {
          ok: true,
          code: 'OK',
          found: true,
          verification_code: r.verification_code,
          mail_time: r.mail_time,
        };
      }
      if (r.terminal) {
        return {
          ok: false,
          code: 'WAREHOUSE_EMAIL_ERROR',
          found: false,
          message: r.message || '获取失败，请稍后重试',
          hint: r.hint || '',
          terminal: true,
        };
      }
      // 还没收到 / 可重试 → 让前端继续轮询（debug 字段方便在浏览器 Network 排查）
      return {
        ok: true,
        code: 'OK',
        found: false,
        status: r.message || '正在查收邮件…',
        debug: r.debug,
      };
    }

    const body: Record<string, any> = {
      email,
      time_range: timeRange,
      clear_cache: !!params.clearCache,
      mark_read: !!params.markRead,
      mail_id: params.mailId || '',
    };

    try {
      const r = await this.forge.request<any>('POST', '/openapi/v1/email-code', body);
      return { ok: true, code: 'OK', request_id: r.requestId, ...(r.data || {}) };
    } catch (e) {
      // 上游业务错误：翻译成友好结构，返回 200
      if (e instanceof ForgeApiError) {
        const friendly = this.describeError(e.code);
        return {
          ok: false,
          code: e.code || 'UPSTREAM_ERROR',
          found: false,
          message: friendly.message,
          hint: friendly.hint || '',
          terminal: friendly.terminal,
          request_id: e.requestId,
        };
      }
      // 网络 / 超时等：可继续重试，不报错
      if (e instanceof ServiceUnavailableException) {
        return {
          ok: false,
          code: 'SERVICE_UNAVAILABLE',
          found: false,
          message: '网络不稳定，正在重试',
          hint: '正在尝试重新连接接码服务。',
          terminal: false,
        };
      }
      this.logger.error(`email-code unexpected error: ${(e as Error)?.message}`);
      return {
        ok: false,
        code: 'UNKNOWN',
        found: false,
        message: '获取失败，正在重试',
        hint: '系统会继续尝试。',
        terminal: false,
      };
    }
  }
}
