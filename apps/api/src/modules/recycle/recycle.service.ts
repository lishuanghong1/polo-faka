import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';

/** Cursor 帮助中心「问题分类」入口，提交退款（回收）正文 */
const CLASSIFY_URL = 'https://cursor.com/api/help/support/classify';
/** 取账单周期起始当作购买日期（best-effort） */
const USAGE_SUMMARY_URL = 'https://cursor.com/api/usage-summary';
/** 仓库 content = email----emailpwd----cursorpwd----token */
const WAREHOUSE_SEPARATOR = '----';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export interface RecycleResult {
  ok: boolean;
  email: string | null;
  invoiceNumber: string;
  purchaseDate: string | null;
  /** 实际发送给 Cursor 的正文 */
  message: string;
  /** classify 接口返回的原始 JSON */
  response: unknown;
}

@Injectable()
export class RecycleService {
  private readonly logger = new Logger(RecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在仓库里按邮箱找到账号，取出 content 里的「原始邮箱 + token」。
   * content = email----emailpwd----cursorpwd----token。找不到返回 null。
   */
  private async resolveWarehouse(
    emailLower: string,
  ): Promise<{ email: string; token: string } | null> {
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
      // 兜底：扫描全部账号按 content 第一段 / email 字段做大小写无关匹配
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
      this.logger.warn(`resolveWarehouse failed: ${(e as Error)?.message}`);
      return null;
    }
    if (!content) return null;

    const parts = content.split(WAREHOUSE_SEPARATOR).map((s) => s.trim());
    const email = parts[0] || emailLower;
    // token 段可能自身含 ----，从第 4 段起整体拼回
    const token =
      parts.length >= 4
        ? parts.slice(3).join(WAREHOUSE_SEPARATOR)
        : parts[parts.length - 1] || '';
    if (!token) return null;
    return { email, token };
  }

  /** 公开入口：邮箱匹配仓库账号后向 Cursor 提交退款请求 */
  async submit(emailInput: string, invoiceInput: string): Promise<RecycleResult> {
    const emailLower = (emailInput || '').trim().toLowerCase();
    if (!emailLower || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      throw new BadRequestException('邮箱格式不正确');
    }
    const invoiceNumber = (invoiceInput || '').trim();
    if (!invoiceNumber) {
      throw new BadRequestException('请填写账单号');
    }

    const hit = await this.resolveWarehouse(emailLower);
    if (!hit) {
      throw new NotFoundException('没有找到这个邮箱对应的账号，请确认是在本站购买的账号');
    }

    const purchaseDate = await this.fetchPurchaseDate(hit.token);
    const message = this.buildMessage(hit.email, invoiceNumber, purchaseDate);

    let response: unknown = null;
    try {
      const resp = await axios.post(
        CLASSIFY_URL,
        { message },
        {
          timeout: 20000,
          headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
            Origin: 'https://cursor.com',
            Referer: 'https://cursor.com/cn/help',
            'User-Agent': USER_AGENT,
            Cookie: `WorkosCursorSessionToken=${hit.token}`,
            Authorization: `Bearer ${hit.token}`,
          },
        },
      );
      response = resp.data;
    } catch (e: any) {
      const status = e?.response?.status;
      this.logger.warn(`classify failed: status=${status} msg=${e?.message}`);
      throw new BadRequestException(
        status
          ? `提交回收请求失败（Cursor 返回 ${status}），账号 token 可能已失效`
          : '提交回收请求失败，请稍后再试',
      );
    }

    return { ok: true, email: hit.email, invoiceNumber, purchaseDate, message, response };
  }

  /** best-effort：从用量接口取账单周期起始当购买日期，失败返回 null */
  private async fetchPurchaseDate(token: string): Promise<string | null> {
    try {
      const resp = await axios.get(USAGE_SUMMARY_URL, {
        timeout: 12000,
        headers: {
          Accept: 'application/json',
          Cookie: `WorkosCursorSessionToken=${token}`,
          Authorization: `Bearer ${token}`,
          Referer: 'https://cursor.com/dashboard/usage',
          'User-Agent': USER_AGENT,
        },
      });
      const b = resp.data || {};
      const raw =
        b.billingCycleStart ||
        b.periodStart ||
        b.startDate ||
        b?.billingPeriod?.startDate ||
        b?.data?.billingCycleStart ||
        b?.data?.startDate;
      if (typeof raw === 'string') return this.formatDate(raw);
    } catch {
      // best-effort，忽略
    }
    return null;
  }

  private formatDate(raw: string): string | null {
    const s = (raw || '').trim();
    if (!s) return null;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    if (s.length >= 10 && s[4] === '-' && s[7] === '-') return s.slice(0, 10);
    return null;
  }

  private buildMessage(email: string, invoice: string, date: string | null): string {
    const purchaseDate = date || '[Purchase Date]';
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
      `Purchase Date: ${purchaseDate}`,
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
