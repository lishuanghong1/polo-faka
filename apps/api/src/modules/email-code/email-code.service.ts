import { BadRequestException, Injectable } from '@nestjs/common';

export interface FetchCodeParams {
  email: string;
  timeRange?: number;
  clearCache?: boolean;
  markRead?: boolean;
  mailId?: string;
}

/** 接码渠道已移除；保留历史客户端协议并明确终止轮询。 */
@Injectable()
export class EmailCodeService {
  async isEnabled() {
    return false;
  }

  async fetchCode(params: FetchCodeParams) {
    const email = (params.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }
    return {
      ok: false,
      code: 'SERVICE_DISABLED',
      found: false,
      message: '在线接码服务已停用',
      hint: '请使用账号自身的邮箱收取验证码，或联系客服处理。',
      terminal: true,
    };
  }
}
