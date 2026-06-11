import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';

/** 仓库 content = email----emailpwd----clientId----refreshToken----cursorpwd----cursorToken */
const WAREHOUSE_SEPARATOR = '----';

/** Cursor 退款邮件收件人（临时测试：先发到自己邮箱，确认后改回 hi@cursor.com） */
const SUPPORT_EMAIL = '1209807583@qq.com';
const MAIL_SUBJECT = 'Refund Request - Cursor Pro Subscription';

/** 微软 OAuth：用 Thunderbird 公开 client_id 的 refresh_token 换 SMTP 访问令牌 */
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SMTP_SCOPE = 'https://outlook.office.com/SMTP.Send offline_access';
/** outlook.com 个人账号用 smtp-mail.outlook.com；M365 用 smtp.office365.com，按序兜底 */
const SMTP_HOSTS = ['smtp-mail.outlook.com', 'smtp.office365.com'];
const SMTP_PORT = 587;

const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface MailboxCreds {
  email: string;
  clientId: string;
  refreshToken: string;
}

export interface RecycleResult {
  ok: boolean;
  email: string;
  invoiceNumber: string;
  /** 收件人 */
  to: string;
  /** 实际发送的正文 */
  message: string;
  /** SMTP 返回（messageId / accepted 等） */
  response: unknown;
}

@Injectable()
export class RecycleService {
  private readonly logger = new Logger(RecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在仓库里按邮箱找到账号 content，解析出发信所需的微软邮箱令牌。
   * content = email----emailpwd----clientId----refreshToken----cursorpwd----cursorToken
   * 用特征匹配（@ / GUID / M. 前缀）取字段，避免顺序变动时解析错位。
   */
  private async resolveMailbox(emailLower: string): Promise<MailboxCreds | null> {
    let content: string | null = null;
    try {
      const byEmail = await this.prisma.warehouseAccount.findFirst({
        where: { email: emailLower },
        orderBy: { id: 'desc' },
      });
      content = byEmail?.content ?? null;
      if (!content) {
        const byContent = await this.prisma.warehouseAccount.findFirst({
          where: { content: { startsWith: emailLower } },
          orderBy: { id: 'desc' },
        });
        content = byContent?.content ?? null;
      }
      if (!content) {
        const all = await this.prisma.warehouseAccount.findMany({
          select: { content: true, email: true },
          take: 5000,
        });
        const hit = all.find((r) => {
          const e0 = (r.content || '')
            .split(WAREHOUSE_SEPARATOR)[0]
            ?.trim()
            .toLowerCase();
          return e0 === emailLower || (r.email || '').trim().toLowerCase() === emailLower;
        });
        content = hit?.content ?? null;
      }
    } catch (e) {
      this.logger.warn(`resolveMailbox failed: ${(e as Error)?.message}`);
      return null;
    }
    if (!content) return null;

    const parts = content.split(WAREHOUSE_SEPARATOR).map((s) => s.trim());
    const email = parts.find((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) || parts[0] || emailLower;
    const clientId = parts.find((p) => GUID_RE.test(p));
    // 微软 refresh_token 以 "M." 开头且较长
    const refreshToken = parts.find((p) => /^M\.[A-Za-z0-9]/.test(p) && p.length > 40);

    if (!clientId || !refreshToken) return null;
    return { email, clientId, refreshToken };
  }

  /** 公开入口：邮箱匹配仓库账号后，用该邮箱给 Cursor 发退款邮件 */
  async submit(emailInput: string, invoiceInput: string): Promise<RecycleResult> {
    const emailLower = (emailInput || '').trim().toLowerCase();
    if (!emailLower || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      throw new BadRequestException('邮箱格式不正确');
    }
    const invoiceNumber = (invoiceInput || '').trim();
    if (!invoiceNumber) {
      throw new BadRequestException('请填写账单号');
    }

    const box = await this.resolveMailbox(emailLower);
    if (!box) {
      throw new NotFoundException(
        '没有找到这个邮箱对应的账号，或账号缺少可用的邮箱令牌，请确认是在本站购买的账号',
      );
    }

    const accessToken = await this.getAccessToken(box.clientId, box.refreshToken);
    const message = this.buildMessage(box.email, invoiceNumber);
    const response = await this.sendMail(box.email, accessToken, message);

    this.logger.log(
      `[recycle] refund mail sent from ${box.email} to ${SUPPORT_EMAIL} (invoice ${invoiceNumber}): ${JSON.stringify(
        response,
      )}`,
    );

    return {
      ok: true,
      email: box.email,
      invoiceNumber,
      to: SUPPORT_EMAIL,
      message,
      response,
    };
  }

  /** refresh_token → access_token（Thunderbird 公开 client_id，无需 client_secret） */
  private async getAccessToken(clientId: string, refreshToken: string): Promise<string> {
    const params = new URLSearchParams();
    params.set('client_id', clientId);
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', refreshToken);
    params.set('scope', SMTP_SCOPE);

    try {
      const resp = await axios.post(TOKEN_URL, params.toString(), {
        timeout: 15000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const token = resp.data?.access_token;
      if (!token) {
        throw new Error('token endpoint 未返回 access_token');
      }
      return token as string;
    } catch (e: any) {
      const detail =
        e?.response?.data?.error_description || e?.response?.data?.error || e?.message;
      this.logger.warn(`getAccessToken failed: ${detail}`);
      throw new BadRequestException('该账号的邮箱令牌已失效，无法发送邮件');
    }
  }

  /** SMTP XOAUTH2 发信；个人/企业 SMTP 主机按序兜底 */
  private async sendMail(
    email: string,
    accessToken: string,
    message: string,
  ): Promise<{ messageId?: string; accepted?: unknown; host: string }> {
    let lastErr: unknown = null;
    for (const host of SMTP_HOSTS) {
      try {
        const transporter = nodemailer.createTransport({
          host,
          port: SMTP_PORT,
          secure: false, // STARTTLS
          auth: {
            type: 'OAuth2',
            user: email,
            accessToken,
          },
        });
        const info = await transporter.sendMail({
          from: email,
          to: SUPPORT_EMAIL,
          subject: MAIL_SUBJECT,
          text: message,
        });
        return { messageId: info.messageId, accepted: info.accepted, host };
      } catch (e) {
        lastErr = e;
        this.logger.warn(`sendMail via ${host} failed: ${(e as Error)?.message}`);
      }
    }
    throw new BadRequestException(
      `发送邮件失败：${(lastErr as Error)?.message || '请稍后再试'}`,
    );
  }

  private buildMessage(email: string, invoice: string): string {
    return [
      'Hello Cursor Support,',
      '',
      'I would like to request a refund for my Cursor Pro subscription.',
      '',
      `Account Email: ${email}`,
      '',
      `Invoice Number: ${invoice}`,
      '',
      'Payment Method: Alipay',
      '',
      'I am requesting this refund within 24 hours of purchase.',
      '',
      'I recently purchased Cursor Pro, but the subscription did not meet my expectations. ' +
        'Therefore, I would like to request a refund and cancellation of my subscription.',
      '',
      'I would appreciate your assistance with processing this refund.',
      '',
      'Thank you for your time and support.',
      '',
      'Best regards',
    ].join('\n');
  }
}
