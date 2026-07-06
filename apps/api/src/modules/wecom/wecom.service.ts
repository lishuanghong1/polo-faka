import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 企业微信「群机器人」通知。
 * 后台在「站点设置 → 企业微信」里填 webhook 地址 + 开关，本服务据此推送：
 *   - 售出账号到退款时间的提醒（含完整凭据）
 *   - 前台退款申请提醒
 *
 * 群机器人文档：webhook POST { msgtype, markdown|text }，返回 { errcode:0, errmsg:"ok" }。
 * markdown 正文上限 4096 字节。
 */

const SETTING_ENABLED = 'wecom_notify_enabled';
const SETTING_WEBHOOK = 'wecom_webhook_url';

export interface WeComSendResult {
  ok: boolean;
  error?: string;
}

@Injectable()
export class WeComService {
  private readonly logger = new Logger(WeComService.name);

  constructor(private prisma: PrismaService) {}

  private async readSetting(key: string): Promise<string> {
    const row = await this.prisma.siteSetting.findUnique({ where: { key } });
    return (row?.value ?? '').trim();
  }

  async getConfig(): Promise<{ enabled: boolean; webhook: string }> {
    const [enabledRaw, webhook] = await Promise.all([
      this.readSetting(SETTING_ENABLED),
      this.readSetting(SETTING_WEBHOOK),
    ]);
    const enabled = (enabledRaw === 'true' || enabledRaw === '1') && !!webhook;
    return { enabled, webhook };
  }

  async isEnabled(): Promise<boolean> {
    return (await this.getConfig()).enabled;
  }

  /** 发 markdown 消息；未启用/未配置时静默跳过（返回 ok:false 但不抛） */
  async sendMarkdown(content: string): Promise<WeComSendResult> {
    const { enabled, webhook } = await this.getConfig();
    if (!enabled) return { ok: false, error: '企业微信通知未启用或未配置 webhook' };
    return this.post(webhook, {
      msgtype: 'markdown',
      markdown: { content: content.slice(0, 4000) },
    });
  }

  /** 发纯文本消息（上限 2048 字节） */
  async sendText(content: string): Promise<WeComSendResult> {
    const { enabled, webhook } = await this.getConfig();
    if (!enabled) return { ok: false, error: '企业微信通知未启用或未配置 webhook' };
    return this.post(webhook, {
      msgtype: 'text',
      text: { content: content.slice(0, 2000) },
    });
  }

  private async post(webhook: string, body: Record<string, any>): Promise<WeComSendResult> {
    try {
      const resp = await axios.post(webhook, body, {
        timeout: 12000,
        headers: { 'Content-Type': 'application/json' },
      });
      const code = resp.data?.errcode;
      if (code !== 0) {
        const msg = `企业微信返回 errcode=${code} errmsg=${resp.data?.errmsg}`;
        this.logger.warn(msg);
        return { ok: false, error: msg };
      }
      return { ok: true };
    } catch (e) {
      const msg = (e as Error)?.message || '企业微信推送失败';
      this.logger.error(`wecom push failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
