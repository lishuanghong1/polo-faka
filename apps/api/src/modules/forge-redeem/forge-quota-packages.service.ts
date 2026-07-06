import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ForgeOpenapiService } from '../forge-openapi/forge-openapi.service';
import { UpdateForgeQuotaPackageDto } from './dto';

/**
 * 额度包（中转 Key 额度包兑换码）数据职责：
 * - 管理员：手动「同步」额度包（拉 /quota-packages → upsert 本地表 → 默认未上架）
 * - 前台：读本地表（额度包无库存概念，无需实时打三方）
 *
 * 对应三方接口：GET /openapi/v1/quota-packages
 */

interface UpstreamQuotaRaw {
  packages: Array<{
    package_key: string;
    name: string;
    quota_usd: number;
    line_key: string;
    agent_price: number;
    retail_price: number;
  }>;
  currency?: string;
  redeem_url_prefix?: string;
}

export interface PublicQuotaPackageItem {
  packageKey: string;
  name: string;          // 已做 customName 覆盖
  quotaUsd: number;      // 面值（美元）
  lineKey: string;
  displayPrice: number;  // 本站售价（CNY）
  retailPrice: number;   // 官方零售价（参考）
  pointsAwardEnabled: boolean;
  pointsPayEnabled: boolean;
  pointsAwardRate: number | null;
  subtitle?: string | null;
  coverImage?: string | null;
  description?: string | null;
  highlights?: string[] | null;
  notice?: string | null;
}

function parseHighlights(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      const list = arr.map((x) => String(x)).filter(Boolean);
      return list.length ? list : null;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

@Injectable()
export class ForgeQuotaPackagesService {
  private readonly logger = new Logger(ForgeQuotaPackagesService.name);

  constructor(
    private prisma: PrismaService,
    private forge: ForgeOpenapiService,
  ) {}

  /** 管理员触发：拉三方额度包 → upsert 本地表 */
  async syncPackages() {
    const r = await this.forge.request<UpstreamQuotaRaw>('GET', '/openapi/v1/quota-packages');
    const packages = r.data?.packages || [];
    let upserted = 0;
    for (const p of packages) {
      const agentPrice = Number(p.agent_price ?? 0);
      await this.prisma.forgeQuotaPackage.upsert({
        where: { packageKey: p.package_key },
        create: {
          packageKey: p.package_key,
          name: p.name,
          quotaUsd: new Prisma.Decimal(p.quota_usd ?? 0),
          lineKey: p.line_key || '',
          agentPrice: new Prisma.Decimal(agentPrice),
          retailPrice: new Prisma.Decimal(p.retail_price ?? 0),
          // 默认售价 = 官方零售价（比成本安全），管理员上架前自行调整
          displayPrice: new Prisma.Decimal(p.retail_price ?? agentPrice),
          enabled: false,
          lastSyncAt: new Date(),
        },
        update: {
          name: p.name,
          quotaUsd: new Prisma.Decimal(p.quota_usd ?? 0),
          lineKey: p.line_key || '',
          agentPrice: new Prisma.Decimal(agentPrice),
          retailPrice: new Prisma.Decimal(p.retail_price ?? 0),
          lastSyncAt: new Date(),
        },
      });
      upserted += 1;
    }
    return { upserted, syncedAt: new Date() };
  }

  /** 管理员列表 */
  async listAdmin() {
    const rows = await this.prisma.forgeQuotaPackage.findMany({
      orderBy: [{ enabled: 'desc' }, { sort: 'asc' }, { quotaUsd: 'asc' }],
    });
    return rows.map((r) => ({
      ...r,
      quotaUsd: Number(r.quotaUsd),
      agentPrice: Number(r.agentPrice),
      retailPrice: Number(r.retailPrice),
      displayPrice: Number(r.displayPrice),
      pointsAwardRate: r.pointsAwardRate !== null ? Number(r.pointsAwardRate) : null,
    }));
  }

  async update(packageKey: string, dto: UpdateForgeQuotaPackageDto) {
    const exists = await this.prisma.forgeQuotaPackage.findUnique({ where: { packageKey } });
    if (!exists) throw new NotFoundException('额度包不存在');

    const norm = (v: string | null | undefined) =>
      v === undefined ? undefined : v === null || v.trim() === '' ? null : v;

    let highlightsVal: string | null | undefined = undefined;
    if (dto.highlights !== undefined) {
      const trimmed = (dto.highlights || '').trim();
      if (!trimmed) {
        highlightsVal = null;
      } else {
        try {
          const arr = JSON.parse(trimmed);
          if (!Array.isArray(arr)) throw new Error('not array');
          highlightsVal = JSON.stringify(arr.map((x) => String(x)).filter(Boolean));
        } catch {
          throw new BadRequestException('亮点列表格式错误，需为 JSON 数组字符串');
        }
      }
    }

    return this.prisma.forgeQuotaPackage.update({
      where: { packageKey },
      data: {
        ...(dto.displayPrice !== undefined && {
          displayPrice: new Prisma.Decimal(dto.displayPrice),
        }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.sort !== undefined && { sort: dto.sort }),
        ...(dto.pointsAwardEnabled !== undefined && {
          pointsAwardEnabled: dto.pointsAwardEnabled,
        }),
        ...(dto.pointsPayEnabled !== undefined && {
          pointsPayEnabled: dto.pointsPayEnabled,
        }),
        ...(dto.pointsAwardRate !== undefined && {
          pointsAwardRate:
            dto.pointsAwardRate === null ? null : new Prisma.Decimal(dto.pointsAwardRate),
        }),
        ...(dto.customName !== undefined && { customName: norm(dto.customName) }),
        ...(dto.subtitle !== undefined && { subtitle: norm(dto.subtitle) }),
        ...(dto.coverImage !== undefined && { coverImage: norm(dto.coverImage) }),
        ...(dto.description !== undefined && { description: norm(dto.description) }),
        ...(highlightsVal !== undefined && { highlights: highlightsVal }),
        ...(dto.notice !== undefined && { notice: norm(dto.notice) }),
      },
    });
  }

  /** 拿单个 enabled 额度包（下单时校验 + 计价） */
  async getEnabledOrThrow(packageKey: string) {
    const p = await this.prisma.forgeQuotaPackage.findUnique({ where: { packageKey } });
    if (!p || !p.enabled) throw new NotFoundException('该额度包不存在或未上架');
    return p;
  }

  /** 前台列表：仅本地表（额度包无库存，价格由本地控制，无需实时打三方） */
  async listPublic(): Promise<PublicQuotaPackageItem[]> {
    const rows = await this.prisma.forgeQuotaPackage.findMany({
      where: { enabled: true },
      orderBy: [{ sort: 'asc' }, { quotaUsd: 'asc' }],
    });
    return rows.map((r) => ({
      packageKey: r.packageKey,
      name: r.customName || r.name,
      quotaUsd: Number(r.quotaUsd),
      lineKey: r.lineKey,
      displayPrice: Number(r.displayPrice),
      retailPrice: Number(r.retailPrice),
      pointsAwardEnabled: r.pointsAwardEnabled,
      pointsPayEnabled: r.pointsPayEnabled,
      pointsAwardRate: r.pointsAwardRate !== null ? Number(r.pointsAwardRate) : null,
      subtitle: r.subtitle ?? null,
      coverImage: r.coverImage ?? null,
      description: r.description ?? null,
      highlights: parseHighlights(r.highlights),
      notice: r.notice ?? null,
    }));
  }

  /** 前台详情 */
  async getPublic(packageKey: string): Promise<PublicQuotaPackageItem | null> {
    const list = await this.listPublic();
    return list.find((p) => p.packageKey === packageKey) || null;
  }
}
