import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CursorQuotaAccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptString, decryptString, maskSecret } from '../../common/crypto.util';
import { CursorUsageService, QuotaCheckError } from './cursor-usage.service';
import { reportToAccountUpdate } from './usage-mapper';
import {
  CreateCursorQuotaDto,
  UpdateCursorQuotaDto,
  BulkImportCursorQuotaDto,
  QueryCursorQuotaDto,
  UpdateCursorQuotaModelSettingsDto,
} from './dto';
import {
  calculateModelRevenue,
  calculateModelUsage,
  CURSOR_QUOTA_AUTO_MODELS_KEY,
  CURSOR_QUOTA_PREMIUM_MODELS_KEY,
  ModelPricingSettings,
  normalizeModelList,
  parseModelList,
} from './model-pricing';

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

  private async readModelPricingSettings(): Promise<ModelPricingSettings> {
    const rows = await this.prisma.siteSetting.findMany({
      where: {
        key: { in: [CURSOR_QUOTA_PREMIUM_MODELS_KEY, CURSOR_QUOTA_AUTO_MODELS_KEY] },
      },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      premiumModels: parseModelList(values.get(CURSOR_QUOTA_PREMIUM_MODELS_KEY)),
      autoModels: parseModelList(values.get(CURSOR_QUOTA_AUTO_MODELS_KEY)),
    };
  }

  private accountPricing(a: any, settings: ModelPricingSettings) {
    const pricePerUsd = Number(a.pricePerUsd ?? 0);
    // 新字段为空代表历史账号，沿用原单价，避免升级后历史收益发生变化。
    const autoPricePerUsd = Number(a.autoPricePerUsd ?? a.pricePerUsd ?? 0);
    const usage = calculateModelUsage(a.modelBreakdown, a.totalCostCents, settings);
    const revenue = calculateModelRevenue(usage, pricePerUsd, autoPricePerUsd);
    return {
      pricePerUsd,
      autoPricePerUsd,
      premiumUsedUsd: Number((usage.premiumCostCents / 100).toFixed(4)),
      autoUsedUsd: Number((usage.autoCostCents / 100).toFixed(4)),
      hasDetailedUsage: usage.hasDetailedUsage,
      modelCategories: usage.modelCategories,
      ...revenue,
    };
  }

  private toDto(a: any, settings: ModelPricingSettings) {
    const purchasePrice = Number(a.purchasePrice ?? 0);
    const usedUsd = Number(((a.totalCostCents ?? 0) / 100).toFixed(4));
    const pricing = this.accountPricing(a, settings);
    const profit = Number((pricing.soldAmount - purchasePrice).toFixed(2));

    return {
      id: a.id,
      email: a.email,
      password: a.password,
      emailPassword: a.emailPassword,
      hasToken: Boolean(a.tokenEnc),
      tokenMask: a.tokenEnc ? maskSecret(decryptString(a.tokenEnc) || '') : '',
      purchasedAt: a.purchasedAt,
      purchasePrice,
      pricePerUsd: pricing.pricePerUsd,
      autoPricePerUsd: pricing.autoPricePerUsd,
      autoPricePerUsdInherited: a.autoPricePerUsd === null || a.autoPricePerUsd === undefined,
      usedUsd,
      premiumUsedUsd: pricing.premiumUsedUsd,
      autoUsedUsd: pricing.autoUsedUsd,
      hasDetailedUsage: pricing.hasDetailedUsage,
      premiumSoldAmount: pricing.premiumSoldAmount,
      autoSoldAmount: pricing.autoSoldAmount,
      soldAmount: pricing.soldAmount,
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
      'autoPricePerUsd',
      'totalCostCents',
      'planPercent',
      'lastCheckedAt',
      'billingCycleEnd',
    ]);
    const sortBy = allowed.has(q.sortBy || '') ? (q.sortBy as string) : 'createdAt';
    const sortOrder = q.sortOrder === 'asc' ? 'asc' : 'desc';

    const [rows, total, settings] = await Promise.all([
      this.prisma.cursorQuotaAccount.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.cursorQuotaAccount.count({ where }),
      this.readModelPricingSettings(),
    ]);

    return { rows: rows.map((r) => this.toDto(r, settings)), total, page, pageSize };
  }

  async get(id: number) {
    const [a, settings] = await Promise.all([
      this.prisma.cursorQuotaAccount.findUnique({ where: { id } }),
      this.readModelPricingSettings(),
    ]);
    if (!a) throw new NotFoundException('账号不存在');
    return this.toDto(a, settings);
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
        autoPricePerUsd: dto.autoPricePerUsd ?? dto.pricePerUsd ?? 1,
        note: dto.note ?? null,
      },
    });
    return this.toDto(a, { premiumModels: [], autoModels: [] });
  }

  async update(id: number, dto: UpdateCursorQuotaDto) {
    const [a, settings] = await Promise.all([
      this.prisma.cursorQuotaAccount.findUnique({ where: { id } }),
      this.readModelPricingSettings(),
    ]);
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
    if (dto.autoPricePerUsd !== undefined) data.autoPricePerUsd = dto.autoPricePerUsd;
    if (dto.note !== undefined) data.note = dto.note;

    const updated = await this.prisma.cursorQuotaAccount.update({ where: { id }, data });
    return this.toDto(updated, settings);
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
    const autoPricePerUsd = dto.autoPricePerUsd ?? pricePerUsd;
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
            autoPricePerUsd,
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
    const [a, settings] = await Promise.all([
      this.prisma.cursorQuotaAccount.findUnique({ where: { id } }),
      this.readModelPricingSettings(),
    ]);
    if (!a) throw new NotFoundException('账号不存在');
    const token = a.tokenEnc ? decryptString(a.tokenEnc) : null;
    if (!token) throw new BadRequestException('该账号未配置 Token，无法查询额度');

    const report = await this.cursor.queryReport(token);
    await this.persistReport(id, report);
    // `success` 是全局响应信封的保留字段，直接返回会被前端误拆成 undefined。
    const { success, ...data } = report;
    const pricing = this.accountPricing(
      {
        ...a,
        totalCostCents: report.totalCostCents,
        modelBreakdown: report.modelBreakdown,
      },
      settings,
    );
    return {
      ...data,
      ok: success,
      pricing: {
        pricePerUsd: pricing.pricePerUsd,
        autoPricePerUsd: pricing.autoPricePerUsd,
        premiumUsedUsd: pricing.premiumUsedUsd,
        autoUsedUsd: pricing.autoUsedUsd,
        premiumSoldAmount: pricing.premiumSoldAmount,
        autoSoldAmount: pricing.autoSoldAmount,
        soldAmount: pricing.soldAmount,
      },
      modelCategories: pricing.modelCategories,
    };
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
      this.prisma.cursorQuotaAccount.update({
        where: { id },
        data: {
          ...update,
          modelBreakdown: report.modelBreakdown as Prisma.InputJsonValue,
        },
      }),
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
      orderBy: { checkedAt: 'desc' },
      take: Math.min(limitN, 500),
    });
    return rows.reverse().map((r) => ({
      checkedAt: r.checkedAt,
      totalCostCents: r.totalCostCents,
      usedCents: r.usedCents,
      percent: r.percent,
    }));
  }

  async modelPricingSettings() {
    const [settings, accounts] = await Promise.all([
      this.readModelPricingSettings(),
      this.prisma.cursorQuotaAccount.findMany({ select: { modelBreakdown: true } }),
    ]);
    const knownModels = new Set<string>([...settings.premiumModels, ...settings.autoModels]);
    for (const account of accounts) {
      const breakdown = account.modelBreakdown;
      if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) continue;
      for (const model of Object.keys(breakdown as Record<string, unknown>)) {
        if (model.trim()) knownModels.add(model.trim());
      }
    }
    return {
      ...settings,
      knownModels: [...knownModels].sort((a, b) =>
        a.localeCompare(b, 'zh-CN', { sensitivity: 'base' }),
      ),
    };
  }

  async updateModelPricingSettings(dto: UpdateCursorQuotaModelSettingsDto) {
    const premiumModels = normalizeModelList(dto.premiumModels);
    const autoModels = normalizeModelList(dto.autoModels);
    const premiumNames = new Set(premiumModels.map((model) => model.toLowerCase()));
    const overlap = autoModels.filter((model) => premiumNames.has(model.toLowerCase()));
    if (overlap.length) {
      throw new BadRequestException(`模型不能同时属于两类：${overlap.slice(0, 5).join('、')}`);
    }
    const premiumValue = JSON.stringify(premiumModels);
    const autoValue = JSON.stringify(autoModels);
    if (Buffer.byteLength(premiumValue, 'utf8') > 60_000) {
      throw new BadRequestException('高级模型配置过长，请减少模型数量或名称长度');
    }
    if (Buffer.byteLength(autoValue, 'utf8') > 60_000) {
      throw new BadRequestException('Auto 模型配置过长，请减少模型数量或名称长度');
    }

    await this.prisma.$transaction([
      this.prisma.siteSetting.upsert({
        where: { key: CURSOR_QUOTA_PREMIUM_MODELS_KEY },
        update: { value: premiumValue, isPublic: false },
        create: {
          key: CURSOR_QUOTA_PREMIUM_MODELS_KEY,
          value: premiumValue,
          isPublic: false,
        },
      }),
      this.prisma.siteSetting.upsert({
        where: { key: CURSOR_QUOTA_AUTO_MODELS_KEY },
        update: { value: autoValue, isPublic: false },
        create: {
          key: CURSOR_QUOTA_AUTO_MODELS_KEY,
          value: autoValue,
          isPublic: false,
        },
      }),
    ]);
    return this.modelPricingSettings();
  }

  async stats() {
    const [total, tokenInvalid, exhausted, lowQuota, all, settings] = await Promise.all([
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
        select: {
          purchasePrice: true,
          pricePerUsd: true,
          autoPricePerUsd: true,
          totalCostCents: true,
          modelBreakdown: true,
        },
      }),
      this.readModelPricingSettings(),
    ]);

    let purchaseTotal = 0;
    let soldPremiumTotal = 0;
    let soldAutoTotal = 0;
    for (const a of all) {
      purchaseTotal += Number(a.purchasePrice ?? 0);
      const pricing = this.accountPricing(a, settings);
      soldPremiumTotal += pricing.premiumSoldAmount;
      soldAutoTotal += pricing.autoSoldAmount;
    }
    purchaseTotal = Number(purchaseTotal.toFixed(2));
    soldPremiumTotal = Number(soldPremiumTotal.toFixed(2));
    soldAutoTotal = Number(soldAutoTotal.toFixed(2));
    const soldTotal = Number((soldPremiumTotal + soldAutoTotal).toFixed(2));
    const profitTotal = Number((soldTotal - purchaseTotal).toFixed(2));

    return {
      counts: { total, tokenInvalid, exhausted, lowQuota },
      purchaseTotal,
      soldPremiumTotal,
      soldAutoTotal,
      soldTotal,
      profitTotal,
    };
  }
}
