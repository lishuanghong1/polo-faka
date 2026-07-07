import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptString, decryptString, isEncrypted } from '../../common/crypto.util';
import { CursorRefundService } from '../cursor-refund/cursor-refund.service';

const SEPARATOR = '----';
const COMMON_SEPARATORS = ['----', '\t', '|', ',', '::'];
const LABELED_RE = /workos[_ ]?cursor[_ ]?session[_ ]?token|access[_ ]?token|session[_ ]?token/i;
const EMAIL_LABEL_RE = /(邮箱|mail|账号|account)\s*[:：]/i;
const TOKEN_RE = /^user_[A-Za-z0-9]+(::|%3A%3A)/i;

function safeDecrypt(v: string | null | undefined): string {
  if (!v) return '';
  try {
    return isEncrypted(v) ? decryptString(v) : v;
  } catch {
    return '';
  }
}

interface ParsedLine {
  email: string;
  token: string;
}

@Injectable()
export class CustomerRefundService {
  private readonly logger = new Logger(CustomerRefundService.name);

  constructor(
    private prisma: PrismaService,
    private cursorRefund: CursorRefundService,
  ) {}

  // ── 解析批量导入（和订阅号池一致的两种格式，只取 email + token） ──

  private looksLabeled(line: string): boolean {
    if (LABELED_RE.test(line)) return true;
    if (EMAIL_LABEL_RE.test(line) && /[:：]/.test(line) && /[|｜]/.test(line)) return true;
    return false;
  }

  private parseLabeled(line: string): ParsedLine | null {
    let email = '';
    let sessionToken = '';
    let accessToken = '';
    for (const field of line.split(/[|｜]/)) {
      const f = field.trim();
      if (!f) continue;
      const idx = f.search(/[:：]/);
      if (idx < 0) continue;
      const key = f.slice(0, idx).trim().toLowerCase();
      const val = f.slice(idx + 1).trim();
      if (!val) continue;
      if (key.includes('邮箱') || key.includes('mail') || key.includes('账号') || key === 'account') email = val;
      else if (key.includes('sessiontoken') || key.includes('session_token') || key.includes('session token')) sessionToken = val;
      else if (key.includes('access')) accessToken = val;
    }
    const token = sessionToken || accessToken;
    if (!email || !token) return null;
    return { email, token };
  }

  private parseDelimited(line: string, preferred: string): ParsedLine | null {
    const seps = [preferred, ...COMMON_SEPARATORS.filter((s) => s !== preferred)];
    for (const sep of seps) {
      if (!sep) continue;
      const parts = line.split(sep).map((p) => p.trim());
      if (parts.length < 2) continue;
      const email = parts.find((p) => p.includes('@')) || '';
      if (!email) continue;
      // token: 优先匹配 user_xxx:: 的段，其次第 4 段
      const token = parts.find((p) => TOKEN_RE.test(p)) || parts[3] || '';
      if (email && token) return { email, token };
    }
    return null;
  }

  private parseBulk(text: string, separator: string) {
    const items: ParsedLine[] = [];
    const errors: { line: number; raw: string; error: string }[] = [];
    const seen = new Set<string>();
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const parsed = this.looksLabeled(line)
        ? this.parseLabeled(line)
        : this.parseDelimited(line, separator) || this.parseLabeled(line);
      if (!parsed || !parsed.email || !parsed.token) {
        errors.push({ line: i + 1, raw, error: '无法解析（需含邮箱 + cursor token）' });
        return;
      }
      const key = parsed.email.toLowerCase();
      if (seen.has(key)) {
        errors.push({ line: i + 1, raw, error: `邮箱 ${parsed.email} 本次重复` });
        return;
      }
      seen.add(key);
      items.push({ email: key, token: parsed.token });
    });
    return { items, errors };
  }

  // ── 管理端 CRUD ──────────────────────────────────

  async list(params: { status?: string; keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));
    const where: Prisma.RefundWhitelistWhereInput = {};
    if (params.status && params.status !== 'all') where.refundStatus = params.status;
    if (params.keyword) where.email = { contains: params.keyword.trim() };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.refundWhitelist.count({ where }),
      this.prisma.refundWhitelist.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: rows.map((r) => this.toView(r)) };
  }

  async addOne(email: string, cursorToken: string, note?: string) {
    const e = (email || '').trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new BadRequestException('邮箱格式不正确');
    if (!cursorToken?.trim()) throw new BadRequestException('请填写 cursor token');
    const exists = await this.prisma.refundWhitelist.findUnique({ where: { email: e } });
    if (exists) throw new BadRequestException('该邮箱已在退款名单');
    const r = await this.prisma.refundWhitelist.create({
      data: { email: e, cursorTokenEnc: encryptString(cursorToken.trim()), note: note ?? null },
    });
    return this.toView(r);
  }

  async update(id: number, dto: { email?: string; cursorToken?: string; note?: string }) {
    const row = await this.prisma.refundWhitelist.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('记录不存在');
    const data: Prisma.RefundWhitelistUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.cursorToken) data.cursorTokenEnc = encryptString(dto.cursorToken.trim());
    if (dto.note !== undefined) data.note = dto.note || null;
    const r = await this.prisma.refundWhitelist.update({ where: { id }, data });
    return this.toView(r);
  }

  async remove(id: number) {
    await this.prisma.refundWhitelist.delete({ where: { id } }).catch(() => null);
    return { ok: true };
  }

  async bulkImport(text: string, separator = SEPARATOR) {
    const { items, errors } = this.parseBulk(text, separator);
    const totalLines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length;
    const batchTag = `RW${Date.now()}`;
    let created = 0;
    for (const it of items) {
      const exists = await this.prisma.refundWhitelist.findUnique({ where: { email: it.email } });
      if (exists) {
        errors.push({ line: 0, raw: it.email, error: `邮箱 ${it.email} 已存在` });
        continue;
      }
      await this.prisma.refundWhitelist.create({
        data: {
          email: it.email,
          cursorTokenEnc: encryptString(it.token),
          batchTag,
        },
      });
      created += 1;
    }
    return { totalLines, created, skipped: errors, batchTag };
  }

  /** 管理端手动退款某条 */
  async refundNow(id: number) {
    const row = await this.prisma.refundWhitelist.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('记录不存在');
    return this.doRefund(row.id, safeDecrypt(row.cursorTokenEnc));
  }

  async resetRefund(id: number) {
    const r = await this.prisma.refundWhitelist.update({
      where: { id },
      data: { refundStatus: 'NONE', refundError: null },
    });
    return this.toView(r);
  }

  // ── 前台客户自助退款 ──────────────────────────────

  /**
   * 客户输入邮箱申请退款：
   *   命中白名单 & 状态 NONE/FAILED → 置 PROCESSING 后台退款，返回"处理中"
   *   已 DONE/PROCESSING → 返回当前状态
   *   不在名单 → 抛 404（对外话术统一为"不符合退款条件"）
   */
  async apply(emailInput: string, ip?: string) {
    const email = (emailInput || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('请输入正确的邮箱');
    }
    const row = await this.prisma.refundWhitelist.findUnique({ where: { email } });
    if (!row) {
      throw new NotFoundException('该邮箱不符合退款条件，请确认邮箱或联系客服');
    }
    if (row.refundStatus === 'DONE') {
      return { status: 'DONE', message: '该账号已完成退款' };
    }
    if (row.refundStatus === 'PROCESSING') {
      return { status: 'PROCESSING', message: '退款处理中，请稍候刷新查看' };
    }
    // NONE / FAILED → 触发
    await this.prisma.refundWhitelist.update({
      where: { id: row.id },
      data: {
        refundStatus: 'PROCESSING',
        refundError: null,
        appliedAt: new Date(),
        appliedIp: ip?.slice(0, 64),
      },
    });
    const token = safeDecrypt(row.cursorTokenEnc);
    // 后台异步执行（退款链较慢，避免请求超时）
    setImmediate(() => {
      this.doRefund(row.id, token).catch((e) =>
        this.logger.error(`bg refund ${row.id}: ${(e as Error).message}`),
      );
    });
    return { status: 'PROCESSING', message: '退款申请已提交，正在处理（约 30 秒），请稍后刷新' };
  }

  /** 前台查询进度（只按邮箱，返回状态，不泄露 token） */
  async status(emailInput: string) {
    const email = (emailInput || '').trim().toLowerCase();
    const row = await this.prisma.refundWhitelist.findUnique({ where: { email } });
    if (!row) return { found: false, status: 'NOT_ELIGIBLE', message: '该邮箱不符合退款条件' };
    const msg =
      row.refundStatus === 'DONE'
        ? '该账号已完成退款'
        : row.refundStatus === 'PROCESSING'
          ? '退款处理中，请稍候刷新'
          : row.refundStatus === 'FAILED'
            ? '上次退款失败，可重新申请'
            : '可申请退款';
    return { found: true, status: row.refundStatus, message: msg };
  }

  /** 实际执行退款并落状态 */
  private async doRefund(id: number, token: string) {
    if (!token) {
      const r = await this.prisma.refundWhitelist.update({
        where: { id },
        data: { refundStatus: 'FAILED', refundError: '缺少 token' },
      });
      return this.toView(r);
    }
    const res = await this.cursorRefund.refundOne(token);
    const r = await this.prisma.refundWhitelist.update({
      where: { id },
      data: res.ok
        ? { refundStatus: 'DONE', refundedAt: new Date(), refundAmount: res.amount || null, refundError: null }
        : { refundStatus: 'FAILED', refundError: (res.error || '退款失败').slice(0, 500) },
    });
    return { ...this.toView(r), ok: res.ok, amount: res.amount, error: res.error, log: res.log };
  }

  private toView(r: any) {
    return {
      id: r.id,
      email: r.email,
      note: r.note,
      batchTag: r.batchTag,
      refundStatus: r.refundStatus,
      refundedAt: r.refundedAt,
      refundAmount: r.refundAmount,
      refundError: r.refundError,
      appliedAt: r.appliedAt,
      createdAt: r.createdAt,
    };
  }
}
