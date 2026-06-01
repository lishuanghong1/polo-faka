import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ForgeApiError, ForgeOpenapiService } from '../forge-openapi/forge-openapi.service';

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

  constructor(private readonly forge: ForgeOpenapiService) {}

  /** site-settings 改动后调用 */
  invalidate() {
    this.forge.invalidate();
  }

  async isEnabled() {
    return this.forge.isEnabled();
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

    const body: Record<string, any> = {
      email,
      time_range: params.timeRange && params.timeRange > 0 ? params.timeRange : 300,
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
