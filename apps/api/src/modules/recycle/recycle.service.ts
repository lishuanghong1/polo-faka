import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { WeComService } from '../wecom/wecom.service';

/** 仓库 content = email----emailpwd----clientId----refreshToken----cursorpwd----cursorToken */
const WAREHOUSE_SEPARATOR = '----';

/** Cursor 退款邮件收件人 */
const SUPPORT_EMAIL = 'hi@cursor.com';
const MAIL_SUBJECT = 'Refund Request - Cursor Pro Subscription';

/** 微软 OAuth：用 Thunderbird 公开 client_id 的 refresh_token 换 SMTP 访问令牌 */
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SMTP_SCOPE = 'https://outlook.office.com/SMTP.Send offline_access';
/** outlook.com 个人账号用 smtp-mail.outlook.com；M365 用 smtp.office365.com，按序兜底 */
const SMTP_HOSTS = ['smtp-mail.outlook.com', 'smtp.office365.com'];
const SMTP_PORT = 587;

/** Cursor 订阅查询接口 */
const STRIPE_PROFILE_URL = 'https://api2.cursor.sh/auth/full_stripe_profile';
const STRIPE_WEB_URL = 'https://cursor.com/api/auth/stripe';
const USAGE_SUMMARY_URL = 'https://cursor.com/api/usage-summary';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface MailboxCreds {
  email: string;
  clientId: string;
  refreshToken: string;
  /** Cursor 会话 token（user_xxx::jwt），用于查订阅 */
  cursorToken: string | null;
  /** 关联订单号（仓库账号售出时回填的 orderNo） */
  orderNo: string | null;
  /** 仓库账号完整 content（企业微信通知里带完整凭据） */
  content: string;
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
  /** 当前订阅 / 状态 */
  plan: string | null;
  status: 'PENDING' | 'SUCCESS' | 'UNKNOWN';
}

/** free/hobby = 已回收成功；pro 等 = 回收中；空 = 未知 */
function classifyPlan(plan?: string | null): 'PENDING' | 'SUCCESS' | 'UNKNOWN' {
  if (!plan) return 'UNKNOWN';
  const p = plan.trim().toLowerCase();
  if (!p) return 'UNKNOWN';
  if (p === 'free' || p === 'hobby' || p === 'none' || p === 'free_tier') {
    return 'SUCCESS';
  }
  return 'PENDING';
}

@Injectable()
export class RecycleService {
  private readonly logger = new Logger(RecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wecom: WeComService,
  ) {}

  /**
   * 在仓库里按邮箱找到账号 content，解析出发信所需的微软邮箱令牌 + Cursor token。
   * content = email----emailpwd----clientId----refreshToken----cursorpwd----cursorToken
   */
  private async resolveMailbox(emailLower: string): Promise<MailboxCreds | null> {
    let content: string | null = null;
    let orderNo: string | null = null;
    try {
      const byEmail = await this.prisma.warehouseAccount.findFirst({
        where: { email: emailLower },
        orderBy: { id: 'desc' },
      });
      content = byEmail?.content ?? null;
      orderNo = byEmail?.orderNo ?? null;
      if (!content) {
        const byContent = await this.prisma.warehouseAccount.findFirst({
          where: { content: { startsWith: emailLower } },
          orderBy: { id: 'desc' },
        });
        content = byContent?.content ?? null;
        orderNo = byContent?.orderNo ?? null;
      }
      if (!content) {
        const all = await this.prisma.warehouseAccount.findMany({
          select: { content: true, email: true, orderNo: true },
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
        orderNo = hit?.orderNo ?? null;
      }
    } catch (e) {
      this.logger.warn(`resolveMailbox failed: ${(e as Error)?.message}`);
      return null;
    }
    if (!content) return null;

    const parts = content.split(WAREHOUSE_SEPARATOR).map((s) => s.trim());
    const email = parts.find((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) || parts[0] || emailLower;
    const clientId = parts.find((p) => GUID_RE.test(p));
    const refreshToken = parts.find((p) => /^M\.[A-Za-z0-9]/.test(p) && p.length > 40);
    const cursorToken =
      parts.find((p) => /^user_[A-Za-z0-9]+(::|%3A%3A)/.test(p)) || null;

    if (!clientId || !refreshToken) return null;
    return { email, clientId, refreshToken, cursorToken, orderNo, content };
  }

  /** 前台退款申请推企业微信（含完整账号信息 + 账单号）；best-effort，不阻塞主流程 */
  private async notifyWeComRecycle(box: MailboxCreds, invoiceNumber: string, plan: string | null) {
    try {
      const md = [
        '## 🧾 前台退款申请',
        `> 用户在前台提交了退款/回收申请。`,
        '',
        `**邮箱**：${box.email}`,
        `**账单号**：${invoiceNumber}`,
        `**订单号**：${box.orderNo || '-'}`,
        `**当前订阅**：${plan || '未知'}`,
        '',
        '**完整账号信息**：',
        `\`\`\`\n${box.content || ''}\n\`\`\``,
      ].join('\n');
      await this.wecom.sendMarkdown(md);
    } catch (e) {
      this.logger.warn(`notifyWeComRecycle failed: ${(e as Error)?.message}`);
    }
  }

  /** 公开入口：邮箱匹配仓库账号后，用该邮箱给 Cursor 发退款邮件，并记录回收申请 */
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

    // 提交后立即查一次订阅，决定初始状态（free=成功 / pro=回收中）
    const plan = box.cursorToken ? await this.fetchPlan(box.cursorToken) : null;
    const status = classifyPlan(plan);

    try {
      await this.prisma.recycleRequest.create({
        data: {
          email: box.email,
          invoiceNumber,
          orderNo: box.orderNo,
          plan: plan ?? null,
          status,
          mailMessageId: response.messageId ?? null,
          lastCheckedAt: box.cursorToken ? new Date() : null,
        },
      });
    } catch (e) {
      this.logger.warn(`save recycle request failed: ${(e as Error)?.message}`);
    }

    // 前台退款申请推企业微信（含完整凭据），best-effort
    await this.notifyWeComRecycle(box, invoiceNumber, plan);

    // 提交即已判定回收成功（账号已是 free）→ 自动从仓库删除对应账号
    if (status === 'SUCCESS') {
      await this.autoDeleteWarehouseForRecycled(box.email.toLowerCase(), box.orderNo);
    }

    this.logger.log(
      `[recycle] refund mail sent from ${box.email} to ${SUPPORT_EMAIL} (invoice ${invoiceNumber}), plan=${plan}, status=${status}: ${JSON.stringify(
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
      plan,
      status,
    };
  }

  // ====== 管理后台：回收列表 / 重新核验 / 删除 ======

  async list(params: { status?: string; keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.keyword) where.email = { contains: params.keyword.trim() };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.recycleRequest.count({ where }),
      this.prisma.recycleRequest.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  /** 重新核验某条回收申请的订阅状态 */
  async refresh(id: number) {
    const req = await this.prisma.recycleRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('回收申请不存在');

    const box = await this.resolveMailbox(req.email.toLowerCase());
    if (!box?.cursorToken) {
      // 账号已不在仓库：若此前已判定回收成功（账号被自动清理），直接返回旧记录，避免误报
      if (req.status === 'SUCCESS') return req;
      throw new BadRequestException('该账号已不在仓库或缺少 Cursor 令牌，无法核验');
    }
    const plan = await this.fetchPlan(box.cursorToken);
    const status = classifyPlan(plan);
    const orderNo = box.orderNo ?? req.orderNo;
    const updated = await this.prisma.recycleRequest.update({
      where: { id },
      data: {
        plan: plan ?? req.plan,
        status,
        orderNo,
        lastCheckedAt: new Date(),
      },
    });

    // 回收成功 → 账号已退款，自动从仓库删除对应账号（保留订单 / 卡密）
    if (status === 'SUCCESS') {
      await this.autoDeleteWarehouseForRecycled(req.email.toLowerCase(), orderNo);
    }
    return updated;
  }

  async remove(id: number) {
    const req = await this.prisma.recycleRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('回收申请不存在');
    await this.prisma.recycleRequest.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * 回收成功后把对应仓库账号从库存自动删除：账号已退款，不应再作为库存留存。
   * - 有订单号：按 orderNo 精确匹配（最可靠）；
   * - 无订单号：回退按邮箱匹配，且仅限「已售出(SOLD)」账号，避免误删尚未售出的新库存。
   * 仅删除 warehouse_accounts 行，保留对应 CardKey 与订单记录。
   * best-effort：失败只记日志，不影响回收主流程。
   */
  private async autoDeleteWarehouseForRecycled(
    emailLower: string,
    orderNo: string | null | undefined,
  ): Promise<number> {
    try {
      const where: any = orderNo
        ? { orderNo }
        : {
            status: 'SOLD',
            OR: [{ email: emailLower }, { content: { startsWith: emailLower } }],
          };
      const accounts = await this.prisma.warehouseAccount.findMany({
        where,
        select: { id: true },
      });
      if (!accounts.length) return 0;
      const ids = accounts.map((a) => a.id);
      const r = await this.prisma.warehouseAccount.deleteMany({
        where: { id: { in: ids } },
      });
      this.logger.log(
        `[recycle] auto-removed ${r.count} warehouse account(s) for ${emailLower} (order=${orderNo ?? '-'})`,
      );
      return r.count;
    } catch (e) {
      this.logger.warn(
        `autoDeleteWarehouseForRecycled failed: ${(e as Error)?.message}`,
      );
      return 0;
    }
  }

  // ====== Cursor 订阅查询 ======

  /** 查 membershipType：full_stripe_profile(JWT) → /api/auth/stripe(cookie) → usage-summary */
  private async fetchPlan(cursorToken: string): Promise<string | null> {
    const token = cursorToken.replace(/%3A%3A/gi, '::').trim();
    const jwt = token.includes('::') ? token.split('::')[1] : token;

    // 1) api2.cursor.sh/auth/full_stripe_profile（Bearer JWT）
    try {
      const r = await axios.get(STRIPE_PROFILE_URL, {
        timeout: 12000,
        headers: { Authorization: `Bearer ${jwt}`, 'User-Agent': BROWSER_UA },
      });
      const m = r.data?.membershipType;
      if (typeof m === 'string' && m) return m;
    } catch {
      /* 继续兜底 */
    }

    // 2) cursor.com/api/auth/stripe（Cookie 会话串）
    try {
      const r = await axios.get(STRIPE_WEB_URL, {
        timeout: 12000,
        headers: {
          Cookie: `WorkosCursorSessionToken=${token}`,
          Authorization: `Bearer ${token}`,
          Referer: 'https://cursor.com/dashboard',
          'User-Agent': BROWSER_UA,
        },
      });
      const m = r.data?.membershipType;
      if (typeof m === 'string' && m) return m;
    } catch {
      /* 继续兜底 */
    }

    // 3) usage-summary 里的 membershipType
    try {
      const r = await axios.get(USAGE_SUMMARY_URL, {
        timeout: 12000,
        headers: {
          Cookie: `WorkosCursorSessionToken=${token}`,
          Authorization: `Bearer ${token}`,
          Referer: 'https://cursor.com/dashboard/usage',
          'User-Agent': BROWSER_UA,
        },
      });
      const m = r.data?.membershipType || r.data?.plan;
      if (typeof m === 'string' && m) return m;
    } catch {
      /* 查不到 */
    }

    return null;
  }

  // ====== 微软邮箱发信 ======

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
