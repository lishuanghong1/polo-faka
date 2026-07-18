import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CursorQuotaAccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptString, decryptString, maskSecret } from '../../common/crypto.util';
import { CursorUsageService, QuotaCheckError } from './cursor-usage.service';
import { reportToAccountUpdate, calcSoldAmount } from './usage-mapper';
import {
  CreateCursorQuotaDto,
  UpdateCursorQuotaDto,
  BulkImportCursorQuotaDto,
  QueryCursorQuotaDto,
} from './dto';

const SEP = '----';

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

@Injectable()
export class CursorQuotaService {
  private readonly logger = new Logger(CursorQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cursor: CursorUsageService,
  ) {}

  private toDto(a: any) {
    const purchasePrice = Number(a.purchasePrice ?? 0);
    const pricePerUsd = Number(a.pricePerUsd ?? 0);
    const usedUsd = Number(((a.totalCostCents ?? 0) / 100).toFixed(4));
    const soldAmount = calcSoldAmount(a.totalCostCents, pricePerUsd);
    const profit = Number((soldAmount - purchasePrice).toFixed(2));

    return {
      id: a.id,
      email: a.email,
      password: a.password,
      emailPassword: a.emailPassword,
      hasToken: Boolean(a.tokenEnc),
      tokenMask: a.tokenEnc ? maskSecret(decryptString(a.tokenEnc) || '') : '',
      purchasedAt: a.purchasedAt,
      purchasePrice,
      pricePerUsd,
      usedUsd,
      soldAmount,
      profit,
      membershipType: a.membershipType,
      isUnlimited: a.isUnlimited,
      planUsedCents: a.planUsedCents,
      planLimitCents: a.planLimitCents,
      planPercent: a.planPercent,
      onDemandCents: a.onDemandCents,
      totalCostCents: a.totalCostCents,
      billingCycleStart: a.billingCycleStart,
      billingCycleEnd: a.billingCycleEnd,
      accountStatus: a.accountStatus,
      lastCheckedAt: a.lastCheckedAt,
      lastCheckError: a.lastCheckError,
      note: a.note,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  async list(q: QueryCursorQuotaDto) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 20, 200);
    const where: Prisma.CursorQuotaAccountWhereInput = {};

    if (q.keyword) {
      where.OR = [{ email: { contains: q.keyword } }, { note: { contains: q.keyword } }];
    }
    if (q.accountStatus) {
      where.accountStatus = q.accountStatus as CursorQuotaAccountStatus;
    }

    const allowed = new Set([
      'createdAt',
      'purchasedAt',
      'purchasePrice',
      'pricePerUsd',
      'totalCostCents',
      'planPercent',
      'lastCheckedAt',
      'billingCycleEnd',
    ]);
    const sortBy = allowed.has(q.sortBy || '') ? (q.sortBy as string) : 'createdAt';
    const sortOrder = q.sortOrder === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      this.prisma.cursorQuotaAccount.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.cursorQuotaAccount.count({ where }),
    ]);

    return { rows: rows.map((r) => this.toDto(r)), total, page, pageSize };
  }

  async get(id: number) {
    const a = await this.prisma.cursorQuotaAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('账号不存在');
    return this.toDto(a);
  }

  async create(dto: CreateCursorQuotaDto) {
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.cursorQuotaAccount.findUnique({ where: { email } });
    if (exists) throw new BadRequestException(`账号 ${email} 已存在`);

    const a = await this.prisma.cursorQuotaAccount.create({
      data: {
        email,
        password: dto.password ?? null,
        emailPassword: dto.emailPassword ?? null,
        tokenEnc: dto.token ? encryptString(dto.token.trim()) : null,
        purchasedAt: dto.purchasedAt ? new Date(dto.purchasedAt) : new Date(),
        purchasePrice: dto.purchasePrice ?? 0,
        pricePerUsd: dto.pricePerUsd ?? 1,
        note: dto.note ?? null,
      },
    });
    return this.toDto(a);
  }

  async update(id: number, dto: UpdateCursorQuotaDto) {
    const a = await this.prisma.cursorQuotaAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('账号不存在');

    const data: Prisma.CursorQuotaAccountUpdateInput = {};
    if (dto.password !== undefined) data.password = dto.password;
    if (dto.emailPassword !== undefined) data.emailPassword = dto.emailPassword;
    if (dto.token !== undefined) {
      data.tokenEnc = dto.token ? encryptString(dto.token.trim()) : null;
    }
    if (dto.purchasedAt !== undefined) {
      data.purchasedAt = dto.purchasedAt ? new Date(dto.purchasedAt) : null;
    }
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;
    if (dto.pricePerUsd !== undefined) data.pricePerUsd = dto.pricePerUsd;
    if (dto.note !== undefined) data.note = dto.note;

    const updated = await this.prisma.cursorQuotaAccount.update({ where: { id }, data });
    return this.toDto(updated);
  }

  async remove(id: number) {
    await this.prisma.cursorQuotaAccount.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('账号不存在');
    });
    return { ok: true };
  }

  async bulkImport(dto: BulkImportCursorQuotaDto) {
    const lines = (dto.text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) throw new BadRequestException('导入内容为空');

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const pricePerUsd = dto.pricePerUsd ?? 1;
    const purchasePrice = dto.purchasePrice ?? 0;

    for (const line of lines) {
      const parts = line.split(SEP).map((p) => p.trim());
      const email = (parts[0] || '').toLowerCase();
      if (!email || !email.includes('@')) {
        errors.push(`跳过（邮箱无效）：${line.slice(0, 40)}`);
        continue;
      }
      try {
        const exists = await this.prisma.cursorQuotaAccount.findUnique({ where: { email } });
        if (exists) {
          skipped += 1;
          continue;
        }
        await this.prisma.cursorQuotaAccount.create({
          data: {
            email,
            emailPassword: parts[1] || null,
            password: parts[2] || null,
            tokenEnc: parts[3] ? encryptString(parts[3]) : null,
            purchasedAt: new Date(),
            purchasePrice,
            pricePerUsd,
          },
        });
        created += 1;
      } catch (e: any) {
        errors.push(`失败：${email} - ${e?.message || '未知错误'}`);
      }
    }

    return { created, skipped, errorCount: errors.length, errors: errors.slice(0, 20) };
  }

  async report(id: number) {
    const a = await this.prisma.cursorQuotaAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('账号不存在');
    const token = a.tokenEnc ? decryptString(a.tokenEnc) : null;
    if (!token) throw new BadRequestException('该账号未配置 Token，无法查询额度');

    const report = await this.cursor.queryReport(token);
    await this.persistReport(id, report);
    // `success` 是全局响应信封的保留字段，直接返回会被前端误拆成 undefined。
    const { success, ...data } = report;
    return { ...data, ok: success };
  }

  async refresh(id: number) {
    const a = await this.prisma.cursorQuotaAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('账号不存在');
    return this.refreshAccount(a);
  }

  async refreshAll() {
    const accounts = await this.prisma.cursorQuotaAccount.findMany({
      where: { tokenEnc: { not: null } },
    });
    const concurrency = Number(process.env.USAGE_REFRESH_CONCURRENCY || 4);
    const results = await mapPool(accounts, concurrency, (a) => this.refreshAccount(a));
    const ok = results.filter((r) => r.ok).length;
    return { total: accounts.length, ok, failed: accounts.length - ok };
  }

  private async refreshAccount(a: { id: number; tokenEnc: string | null }) {
    const token = a.tokenEnc ? decryptString(a.tokenEnc) : null;
    if (!token) return { ok: false, error: '未配置 Token' };
    try {
      const report = await this.cursor.queryReport(token);
      await this.persistReport(a.id, report);
      return { ok: true };
    } catch (e: any) {
      const isAuth = e instanceof QuotaCheckError && e.statusCode === 401;
      await this.prisma.cursorQuotaAccount.update({
        where: { id: a.id },
        data: {
          accountStatus: isAuth ? CursorQuotaAccountStatus.TOKEN_INVALID : undefined,
          lastCheckedAt: new Date(),
          lastCheckError: e?.message || '查询失败',
        },
      });
      return { ok: false, error: e?.message || '查询失败' };
    }
  }

  private async persistReport(id: number, report: any) {
    const update = reportToAccountUpdate(report);
    await this.prisma.$transaction([
      this.prisma.cursorQuotaAccount.update({ where: { id }, data: update }),
      this.prisma.cursorQuotaSnapshot.create({
        data: {
          accountId: id,
          usedCents: report.includedCostCents ?? 0,
          totalCostCents: report.totalCostCents ?? 0,
          percent: report.totalPercentUsed ?? null,
          membershipType: report.membershipType ?? null,
        },
      }),
    ]);
  }

  async snapshots(id: number, limitN = 100) {
    const a = await this.prisma.cursorQuotaAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('账号不存在');
    const rows = await this.prisma.cursorQuotaSnapshot.findMany({
      where: { accountId: id },
      orderBy: { checkedAt: 'asc' },
      take: Math.min(limitN, 500),
    });
    return rows.map((r) => ({
      checkedAt: r.checkedAt,
      totalCostCents: r.totalCostCents,
      usedCents: r.usedCents,
      percent: r.percent,
    }));
  }

  async stats() {
    const [total, tokenInvalid, exhausted, lowQuota, all] = await Promise.all([
      this.prisma.cursorQuotaAccount.count(),
      this.prisma.cursorQuotaAccount.count({
        where: { accountStatus: CursorQuotaAccountStatus.TOKEN_INVALID },
      }),
      this.prisma.cursorQuotaAccount.count({
        where: { accountStatus: CursorQuotaAccountStatus.EXHAUSTED },
      }),
      this.prisma.cursorQuotaAccount.count({
        where: { accountStatus: CursorQuotaAccountStatus.LOW_QUOTA },
      }),
      this.prisma.cursorQuotaAccount.findMany({
        select: { purchasePrice: true, pricePerUsd: true, totalCostCents: true },
      }),
    ]);

    let purchaseTotal = 0;
    let soldTotal = 0;
    for (const a of all) {
      purchaseTotal += Number(a.purchasePrice ?? 0);
      soldTotal += calcSoldAmount(a.totalCostCents, Number(a.pricePerUsd));
    }
    purchaseTotal = Number(purchaseTotal.toFixed(2));
    soldTotal = Number(soldTotal.toFixed(2));
    const profitTotal = Number((soldTotal - purchaseTotal).toFixed(2));

    return {
      counts: { total, tokenInvalid, exhausted, lowQuota },
      purchaseTotal,
      soldTotal,
      profitTotal,
    };
  }
}
