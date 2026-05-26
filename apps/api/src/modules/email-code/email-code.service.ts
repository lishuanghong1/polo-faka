import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ForgeOpenapiService } from '../forge-openapi/forge-openapi.service';

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

  constructor(private readonly forge: ForgeOpenapiService) {}

  /** site-settings 改动后调用 */
  invalidate() {
    this.forge.invalidate();
  }

  async isEnabled() {
    return this.forge.isEnabled();
  }

  /**
   * 调用三方 POST /openapi/v1/email-code，单次直通。
   * 前端每 3s 调一次本接口实现轮询。
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
      return { code: 'OK', request_id: r.requestId, ...(r.data || {}) };
    } catch (e) {
      throw ForgeOpenapiService.toHttpException(e);
    }
  }
}
