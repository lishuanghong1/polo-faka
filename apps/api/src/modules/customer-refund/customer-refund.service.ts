import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import dayjs from 'dayjs';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptString, decryptString, isEncrypted } from '../../common/crypto.util';
import { CursorRefundService } from '../cursor-refund/cursor-refund.service';

const SEPARATOR = '----';
/** token 退款手续费（元）：Ultra ¥50，其它付费档（Pro/Pro+ 等）¥10 */
const REFUND_FEE_ULTRA = 50;
const REFUND_FEE_DEFAULT = 10;
/** 视为「免费/无需退款」的会员类型 */
const FREE_MEMBERSHIPS = new Set(['free', 'free_trial', 'trial']);
const orderNano = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

/** 按会员档位取退款手续费 */
function refundFeeFor(membership: string): number {
  return (membership || '').trim().toLowerCase() === 'ultra'
    ? REFUND_FEE_ULTRA
    : REFUND_FEE_DEFAULT;
}
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

/** token 掩码：首段 + … + 末 6 位，用于日志识别，不落完整明文。 */
function maskToken(raw: string): string {
  const t = (raw || '').replace(/%3A%3A/gi, '::').trim();
  if (!t) return '';
  const head = t.slice(0, 20);
  return t.length > 30 ? `${head}…${t.slice(-6)}` : head;
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

  /**
   * 前台凭 token 直接退款：不校验白名单（token 本身即凭证）。
   * 流程：
   *   1. 校验格式 → 查会员类型（顺带校验 token 是否有效）
   *   2. free → 直接标记「已是免费版，无需退款」
   *   3. 付费档（含 Ultra）→ 先收手续费（Ultra ¥50，其它 ¥10），建 T 支付单，
   *      付款成功后（支付宝回调）再自动办理退款
   */
  async applyByToken(tokenInput: string, ip?: string) {
    const token = (tokenInput || '').trim();
    if (!token) throw new BadRequestException('请输入账号 token');
    if (!/^user_[A-Za-z0-9]+(::|%3A%3A)/i.test(token) && !/WorkosCursorSessionToken=/i.test(token)) {
      throw new BadRequestException('token 格式不正确（应形如 user_xxx::eyJ...）');
    }

    // 查会员类型（同时验证 token 有效性）
    const info = await this.cursorRefund.checkMembership(token);
    if (!info.ok) {
      throw new BadRequestException(info.error || 'token 无效或已失效，请重新获取');
    }
    const membership = (info.membershipType || '').trim();
    const isFree = !membership || FREE_MEMBERSHIPS.has(membership.toLowerCase());

    // 已是免费版：无需退款
    if (isFree) {
      await this.prisma.tokenRefundLog.create({
        data: {
          tokenMask: maskToken(token),
          email: info.email || null,
          membershipType: membership || null,
          status: 'DONE',
          prevMembership: membership || 'free',
          finalMembership: 'free',
          payStatus: 'NONE',
          ip: ip?.slice(0, 64),
          finishedAt: new Date(),
        },
      });
      return { status: 'DONE', message: '该账号已是免费版，无需退款' };
    }

    // 付费档：先收手续费，付款后再退
    const fee = refundFeeFor(membership);
    const payOrderNo = `T${dayjs().format('YYYYMMDDHHmmss')}${orderNano()}`;
    const log = await this.prisma.tokenRefundLog.create({
      data: {
        tokenMask: maskToken(token),
        cursorTokenEnc: encryptString(token),
        email: info.email || null,
        membershipType: membership,
        status: 'NEED_PAY',
        feeAmount: fee,
        payOrderNo,
        payStatus: 'UNPAID',
        ip: ip?.slice(0, 64),
      },
    });
    return {
      status: 'NEED_PAY',
      message: `需支付 ¥${fee} 手续费后自动办理退款`,
      id: log.id,
      payOrderNo,
      feeAmount: fee,
      membershipType: membership,
    };
  }

  /** 后台异步执行退款链并回填 TokenRefundLog（applyByToken 与付费后共用）。 */
  private runTokenRefund(logId: number, token: string) {
    setImmediate(() => {
      this.cursorRefund
        .refundOne(token)
        .then(async (res) => {
          if (res.ok) {
            this.logger.log(`token 退款成功: ${res.email || '?'} 约 $${res.amount}`);
          } else {
            this.logger.warn(`token 退款失败: ${res.email || '?'} - ${res.error}`);
          }
          await this.prisma.tokenRefundLog.update({
            where: { id: logId },
            data: {
              status: res.ok ? 'DONE' : 'FAILED',
              email: res.email || undefined,
              refundAmount: res.amount || null,
              prevMembership: res.prevMembership || null,
              finalMembership: res.finalMembership || null,
              refundError: res.ok ? null : (res.error || '退款失败').slice(0, 500),
              // 退款结束后清掉暂存 token
              cursorTokenEnc: null,
              finishedAt: new Date(),
            },
          });
        })
        .catch(async (e) => {
          const msg = (e as Error)?.message || '退款异常';
          this.logger.error(`token 退款异常: ${msg}`);
          await this.prisma.tokenRefundLog
            .update({
              where: { id: logId },
              data: { status: 'FAILED', refundError: msg.slice(0, 500), finishedAt: new Date() },
            })
            .catch(() => null);
        });
    });
  }

  /**
   * 手续费支付成功回调（支付宝 notify/return 调用）：校验金额、幂等，触发退款。
   * 返回 'recorded' 表示本次刚标记成功并已触发退款；'duplicate' 表示已处理过。
   */
  async markFeePaid(
    payOrderNo: string,
    tradeNo: string,
    paidAmount: number,
  ): Promise<'recorded' | 'duplicate'> {
    const log = await this.prisma.tokenRefundLog.findUnique({ where: { payOrderNo } });
    if (!log) throw new Error('订单不存在');
    if (log.payStatus === 'PAID') return 'duplicate';
    const expect = Number(log.feeAmount || REFUND_FEE_DEFAULT);
    if (Math.abs(Number(paidAmount) - expect) > 0.01) {
      throw new Error(`金额不一致：期望 ${expect}，实付 ${paidAmount}`);
    }
    await this.prisma.tokenRefundLog.update({
      where: { id: log.id },
      data: {
        payStatus: 'PAID',
        payTradeNo: tradeNo,
        paidAt: new Date(),
        status: 'PROCESSING',
      },
    });
    const token = safeDecrypt(log.cursorTokenEnc);
    if (token) this.runTokenRefund(log.id, token);
    else {
      await this.prisma.tokenRefundLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', refundError: 'token 丢失，无法退款', finishedAt: new Date() },
      });
    }
    return 'recorded';
  }

  /** 前台查 token 退款进度（按记录 id） */
  async tokenStatus(id: number) {
    const row = await this.prisma.tokenRefundLog.findUnique({ where: { id } });
    if (!row) return { found: false, status: 'NOT_FOUND', message: '记录不存在' };
    const map: Record<string, string> = {
      NEED_PAY: '待支付手续费',
      PROCESSING: '退款处理中，请稍候刷新',
      DONE: '退款完成，账号已恢复免费版',
      FAILED: row.refundError || '退款失败，请稍后重试或联系客服',
    };
    return {
      found: true,
      status: row.status,
      payStatus: row.payStatus,
      message: map[row.status] || row.status,
    };
  }

  // ── Token 退款记录（后台查看） ────────────────────

  async listTokenRefunds(params: { status?: string; keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));
    const where: Prisma.TokenRefundLogWhereInput = {};
    if (params.status && params.status !== 'all') where.status = params.status;
    if (params.keyword) {
      const kw = params.keyword.trim();
      where.OR = [{ email: { contains: kw } }, { tokenMask: { contains: kw } }];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.tokenRefundLog.count({ where }),
      this.prisma.tokenRefundLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: rows.map((r) => this.toTokenView(r)) };
  }

  async removeTokenRefund(id: number) {
    await this.prisma.tokenRefundLog.delete({ where: { id } }).catch(() => null);
    return { ok: true };
  }

  private toTokenView(r: any) {
    return {
      id: r.id,
      email: r.email,
      tokenMask: r.tokenMask,
      membershipType: r.membershipType,
      status: r.status,
      refundAmount: r.refundAmount,
      prevMembership: r.prevMembership,
      finalMembership: r.finalMembership,
      refundError: r.refundError,
      feeAmount: r.feeAmount,
      payStatus: r.payStatus,
      payOrderNo: r.payOrderNo,
      paidAt: r.paidAt,
      ip: r.ip,
      finishedAt: r.finishedAt,
      createdAt: r.createdAt,
    };
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
