import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decryptString, encryptString, maskSecret } from '../../common/crypto.util';
import { CursorUsageService } from '../cursor-quota/cursor-usage.service';
import { checkCursorToken } from './vault-checker';
import {
  BulkActionVaultDto,
  BulkImportVaultDto,
  CheckBatchVaultDto,
  CreateVaultAccountDto,
  CreateVaultGroupDto,
  ExportVaultDto,
  QueryVaultDto,
  UpdateVaultAccountDto,
  UpdateVaultGroupDto,
  VAULT_STATUSES,
} from './dto';

const EXPIRING_DAYS = 7;
const CHECK_CONCURRENCY = 3;

/** 列表 / 详情安全字段（不含任何密文） */
const SAFE_SELECT = {
  id: true,
  email: true,
  groupId: true,
  status: true,
  tags: true,
  note: true,
  batchTag: true,
  expiresAt: true,
  checkResult: true,
  checkMessage: true,
  membershipType: true,
  planUsedCents: true,
  planLimitCents: true,
  planPercent: true,
  lastCheckAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  group: { select: { id: true, name: true } },
} satisfies Prisma.VaultAccountSelect;

function reqActor(req: Request): { actorId: number | null; actor: string | null } {
  const user = (req as any)?.user;
  return {
    actorId: user?.sub ? Number(user.sub) : null,
    actor: user?.username ? String(user.username) : null,
  };
}

function parseExpiresAt(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('到期时间格式不正确');
  return d;
}

@Injectable()
export class AccountVaultService {
  private readonly logger = new Logger(AccountVaultService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private usage: CursorUsageService,
  ) {}

  private async logEvent(
    accountId: number,
    action: string,
    detail: string | null,
    req: Request,
  ) {
    const { actorId, actor } = reqActor(req);
    try {
      await this.prisma.vaultAccountEvent.create({
        data: { accountId, action, detail, actorId, actor },
      });
    } catch (e) {
      this.logger.warn(`vault event write failed: ${(e as Error).message}`);
    }
  }

  private async logEvents(
    accountIds: number[],
    action: string,
    detail: string | null,
    req: Request,
  ) {
    if (!accountIds.length) return;
    const { actorId, actor } = reqActor(req);
    try {
      await this.prisma.vaultAccountEvent.createMany({
        data: accountIds.map((accountId) => ({ accountId, action, detail, actorId, actor })),
      });
    } catch (e) {
      this.logger.warn(`vault events write failed: ${(e as Error).message}`);
    }
  }

  /** 把带密文的行转成安全行（密文只保留 has 标记） */
  private toSafe(row: any) {
    const { passwordEnc, emailPasswordEnc, tokenEnc, ...rest } = row;
    return {
      ...rest,
      hasPassword: !!passwordEnc,
      hasEmailPassword: !!emailPasswordEnc,
      hasToken: !!tokenEnc,
    };
  }

  // ─────────────────────── 分组 ───────────────────────

  async listGroups() {
    const groups = await this.prisma.vaultGroup.findMany({
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { accounts: { where: { deletedAt: null } } } } },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      sort: g.sort,
      accountCount: g._count.accounts,
    }));
  }

  async createGroup(dto: CreateVaultGroupDto) {
    const exists = await this.prisma.vaultGroup.findUnique({ where: { name: dto.name.trim() } });
    if (exists) throw new BadRequestException('分组名已存在');
    return this.prisma.vaultGroup.create({
      data: { name: dto.name.trim(), sort: dto.sort ?? 0 },
    });
  }

  async updateGroup(id: number, dto: UpdateVaultGroupDto) {
    const group = await this.prisma.vaultGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('分组不存在');
    if (dto.name) {
      const dup = await this.prisma.vaultGroup.findFirst({
        where: { name: dto.name.trim(), id: { not: id } },
      });
      if (dup) throw new BadRequestException('分组名已存在');
    }
    return this.prisma.vaultGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
      },
    });
  }

  async removeGroup(id: number) {
    const group = await this.prisma.vaultGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('分组不存在');
    // 组内账号 FK 置空（onDelete: SetNull），账号本身保留
    await this.prisma.vaultGroup.delete({ where: { id } });
    return { ok: true };
  }

  // ─────────────────────── 统计 ───────────────────────

  async stats() {
    const soon = new Date(Date.now() + EXPIRING_DAYS * 24 * 3600 * 1000);
    // groupBy 放在 $transaction 数组里会触发 Prisma 的类型递归报错，单独 await。
    const byStatus = await this.prisma.vaultAccount.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const [recycled, expiring, invalid, total] = await this.prisma.$transaction([
      this.prisma.vaultAccount.count({ where: { deletedAt: { not: null } } }),
      this.prisma.vaultAccount.count({
        where: { deletedAt: null, expiresAt: { not: null, lte: soon } },
      }),
      this.prisma.vaultAccount.count({
        where: { deletedAt: null, checkResult: 'INVALID' },
      }),
      this.prisma.vaultAccount.count({ where: { deletedAt: null } }),
    ]);
    const statusMap: Record<string, number> = { AVAILABLE: 0, USED: 0, DISABLED: 0 };
    for (const g of byStatus) statusMap[g.status] = g._count._all;
    return { total, ...statusMap, recycled, expiring, invalid };
  }

  /** 批次列表（用于筛选下拉） */
  async batches() {
    const rows = await this.prisma.vaultAccount.groupBy({
      by: ['batchTag'],
      where: { batchTag: { not: null }, deletedAt: null },
      _count: { _all: true },
      orderBy: { batchTag: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({ batchTag: r.batchTag, count: r._count._all }));
  }

  // ─────────────────────── 查询 ───────────────────────

  private buildWhere(q: {
    keyword?: string;
    status?: string;
    groupId?: number;
    batchTag?: string;
    checkResult?: string;
    expiring?: string;
    recycled?: string;
  }): Prisma.VaultAccountWhereInput {
    const where: Prisma.VaultAccountWhereInput = {};
    where.deletedAt = q.recycled === '1' ? { not: null } : null;
    if (q.status) where.status = q.status;
    if (q.groupId !== undefined) where.groupId = q.groupId === 0 ? null : q.groupId;
    if (q.batchTag) where.batchTag = q.batchTag;
    if (q.checkResult === 'UNCHECKED') where.checkResult = null;
    else if (q.checkResult) where.checkResult = q.checkResult;
    if (q.expiring === '1') {
      where.expiresAt = {
        not: null,
        lte: new Date(Date.now() + EXPIRING_DAYS * 24 * 3600 * 1000),
      };
    }
    if (q.keyword?.trim()) {
      const kw = q.keyword.trim();
      where.OR = [
        { email: { contains: kw } },
        { note: { contains: kw } },
        { tags: { contains: kw } },
        { batchTag: { contains: kw } },
      ];
    }
    return where;
  }

  async list(q: QueryVaultDto) {
    const page = Math.max(1, q.page || 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize || 20));
    const where = this.buildWhere(q);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.vaultAccount.count({ where }),
      this.prisma.vaultAccount.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { group: { select: { id: true, name: true } } },
      }),
    ]);
    return { total, page, pageSize, items: rows.map((r) => this.toSafe(r)) };
  }

  async get(id: number) {
    const row = await this.prisma.vaultAccount.findUnique({
      where: { id },
      include: { group: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException('账号不存在');
    const safe = this.toSafe(row);
    // 打码预览（帮助辨认，不算泄露明文，不记 REVEAL）
    return {
      ...safe,
      passwordMasked: row.passwordEnc ? maskSecret(decryptString(row.passwordEnc), 2, 2) : null,
      emailPasswordMasked: row.emailPasswordEnc
        ? maskSecret(decryptString(row.emailPasswordEnc), 2, 2)
        : null,
      tokenMasked: row.tokenEnc ? maskSecret(decryptString(row.tokenEnc), 12, 6) : null,
    };
  }

  /** 查看明文（记操作历史 + 审计日志） */
  async reveal(id: number, req: Request) {
    const row = await this.prisma.vaultAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('账号不存在');
    await this.logEvent(id, 'REVEAL', null, req);
    await this.audit.fromReq(req, 'VAULT_REVEAL', { target: row.email });
    return {
      id: row.id,
      email: row.email,
      password: row.passwordEnc ? decryptString(row.passwordEnc) : null,
      emailPassword: row.emailPasswordEnc ? decryptString(row.emailPasswordEnc) : null,
      token: row.tokenEnc ? decryptString(row.tokenEnc) : null,
    };
  }

  async events(id: number, page = 1, pageSize = 20) {
    const account = await this.prisma.vaultAccount.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('账号不存在');
    const take = Math.min(100, Math.max(1, pageSize));
    const skip = (Math.max(1, page) - 1) * take;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.vaultAccountEvent.count({ where: { accountId: id } }),
      this.prisma.vaultAccountEvent.findMany({
        where: { accountId: id },
        orderBy: { id: 'desc' },
        skip,
        take,
      }),
    ]);
    return { total, page: Math.max(1, page), pageSize: take, items };
  }

  // ─────────────────────── 增改删 ───────────────────────

  async create(dto: CreateVaultAccountDto, req: Request) {
    const email = dto.email.trim().toLowerCase();
    if (!email.includes('@')) throw new BadRequestException('邮箱格式不正确');
    const dup = await this.prisma.vaultAccount.findUnique({ where: { email } });
    if (dup) throw new BadRequestException('该邮箱已存在（可能在回收站）');
    if (dto.groupId) {
      const group = await this.prisma.vaultGroup.findUnique({ where: { id: dto.groupId } });
      if (!group) throw new BadRequestException('分组不存在');
    }
    const row = await this.prisma.vaultAccount.create({
      data: {
        email,
        passwordEnc: dto.password ? encryptString(dto.password) : null,
        emailPasswordEnc: dto.emailPassword ? encryptString(dto.emailPassword) : null,
        tokenEnc: dto.token ? encryptString(dto.token.trim()) : null,
        groupId: dto.groupId ?? null,
        status: dto.status ?? 'AVAILABLE',
        tags: dto.tags?.trim() || null,
        note: dto.note?.trim() || null,
        expiresAt: parseExpiresAt(dto.expiresAt) ?? null,
      },
    });
    await this.logEvent(row.id, 'CREATE', null, req);
    await this.audit.fromReq(req, 'VAULT_CREATE', { target: email });
    return this.get(row.id);
  }

  async update(id: number, dto: UpdateVaultAccountDto, req: Request) {
    const row = await this.prisma.vaultAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('账号不存在');

    const data: Prisma.VaultAccountUpdateInput = {};
    const changed: string[] = [];

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (!email.includes('@')) throw new BadRequestException('邮箱格式不正确');
      if (email !== row.email) {
        const dup = await this.prisma.vaultAccount.findUnique({ where: { email } });
        if (dup) throw new BadRequestException('该邮箱已存在');
        data.email = email;
        changed.push('email');
      }
    }
    if (dto.password !== undefined) {
      data.passwordEnc = dto.password ? encryptString(dto.password) : null;
      changed.push('password');
    }
    if (dto.emailPassword !== undefined) {
      data.emailPasswordEnc = dto.emailPassword ? encryptString(dto.emailPassword) : null;
      changed.push('emailPassword');
    }
    if (dto.token !== undefined) {
      data.tokenEnc = dto.token ? encryptString(dto.token.trim()) : null;
      changed.push('token');
    }
    if (dto.groupId !== undefined) {
      if (dto.groupId) {
        const group = await this.prisma.vaultGroup.findUnique({ where: { id: dto.groupId } });
        if (!group) throw new BadRequestException('分组不存在');
      }
      data.group = dto.groupId
        ? { connect: { id: dto.groupId } }
        : { disconnect: true };
      changed.push('group');
    }
    if (dto.status !== undefined) {
      if (!VAULT_STATUSES.includes(dto.status as any)) {
        throw new BadRequestException('状态不合法');
      }
      data.status = dto.status;
      changed.push('status');
    }
    if (dto.tags !== undefined) {
      data.tags = dto.tags?.trim() || null;
      changed.push('tags');
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() || null;
      changed.push('note');
    }
    const expiresAt = parseExpiresAt(dto.expiresAt);
    if (expiresAt !== undefined) {
      data.expiresAt = expiresAt;
      changed.push('expiresAt');
    }

    if (!changed.length) return this.get(id);
    await this.prisma.vaultAccount.update({ where: { id }, data });
    await this.logEvent(id, 'UPDATE', changed.join(','), req);
    await this.audit.fromReq(req, 'VAULT_UPDATE', {
      target: row.email,
      detail: { changed },
    });
    return this.get(id);
  }

  /** 软删除 → 回收站 */
  async softDelete(id: number, req: Request) {
    const row = await this.prisma.vaultAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('账号不存在');
    if (row.deletedAt) throw new BadRequestException('账号已在回收站');
    await this.prisma.vaultAccount.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.logEvent(id, 'DELETE', null, req);
    await this.audit.fromReq(req, 'VAULT_DELETE', { target: row.email });
    return { ok: true };
  }

  async restore(id: number, req: Request) {
    const row = await this.prisma.vaultAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('账号不存在');
    if (!row.deletedAt) throw new BadRequestException('账号不在回收站');
    await this.prisma.vaultAccount.update({ where: { id }, data: { deletedAt: null } });
    await this.logEvent(id, 'RESTORE', null, req);
    await this.audit.fromReq(req, 'VAULT_RESTORE', { target: row.email });
    return { ok: true };
  }

  /** 彻底删除（仅限已在回收站的账号） */
  async purge(id: number, req: Request) {
    const row = await this.prisma.vaultAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('账号不存在');
    if (!row.deletedAt) throw new BadRequestException('请先移入回收站再彻底删除');
    await this.prisma.vaultAccount.delete({ where: { id } });
    await this.audit.fromReq(req, 'VAULT_PURGE', { target: row.email });
    return { ok: true };
  }

  // ─────────────────────── 批量 ───────────────────────

  async bulkAction(dto: BulkActionVaultDto, req: Request) {
    const ids = Array.from(new Set(dto.ids));
    let count = 0;

    switch (dto.action) {
      case 'delete': {
        const r = await this.prisma.vaultAccount.updateMany({
          where: { id: { in: ids }, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        count = r.count;
        await this.logEvents(ids, 'DELETE', '批量', req);
        break;
      }
      case 'restore': {
        const r = await this.prisma.vaultAccount.updateMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        count = r.count;
        await this.logEvents(ids, 'RESTORE', '批量', req);
        break;
      }
      case 'purge': {
        const r = await this.prisma.vaultAccount.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        count = r.count;
        break;
      }
      case 'status': {
        if (!dto.status) throw new BadRequestException('缺少目标状态');
        const r = await this.prisma.vaultAccount.updateMany({
          where: { id: { in: ids } },
          data: { status: dto.status },
        });
        count = r.count;
        await this.logEvents(ids, 'STATUS', dto.status, req);
        break;
      }
      case 'move': {
        if (dto.groupId) {
          const group = await this.prisma.vaultGroup.findUnique({ where: { id: dto.groupId } });
          if (!group) throw new BadRequestException('分组不存在');
        }
        const r = await this.prisma.vaultAccount.updateMany({
          where: { id: { in: ids } },
          data: { groupId: dto.groupId ?? null },
        });
        count = r.count;
        await this.logEvents(ids, 'MOVE_GROUP', dto.groupId ? `→ 分组#${dto.groupId}` : '→ 未分组', req);
        break;
      }
      default:
        throw new BadRequestException('不支持的操作');
    }

    await this.audit.fromReq(req, `VAULT_BULK_${dto.action.toUpperCase()}`, {
      detail: { ids: ids.length, affected: count },
    });
    return { ok: true, affected: count };
  }

  // ─────────────────────── 批量导入 ───────────────────────

  async bulkImport(dto: BulkImportVaultDto, req: Request) {
    const separator = dto.separator || '----';
    const fields = dto.fields?.length ? dto.fields : ['email', 'password', 'emailPassword', 'token'];
    if (!fields.includes('email')) throw new BadRequestException('字段映射必须包含 email');
    if (new Set(fields).size !== fields.length) {
      throw new BadRequestException('字段映射不能重复');
    }
    if (dto.groupId) {
      const group = await this.prisma.vaultGroup.findUnique({ where: { id: dto.groupId } });
      if (!group) throw new BadRequestException('分组不存在');
    }

    const lines = dto.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) throw new BadRequestException('没有可导入的内容');
    if (lines.length > 5000) throw new BadRequestException('单次最多导入 5000 行');

    const invalid: Array<{ line: string; reason: string }> = [];
    const seen = new Set<string>();
    const rows: Array<{
      email: string;
      password?: string;
      emailPassword?: string;
      token?: string;
      note?: string;
    }> = [];

    for (const line of lines) {
      const cols = line.split(separator).map((c) => c.trim());
      const rec: Record<string, string> = {};
      fields.forEach((f, i) => {
        if (cols[i]) rec[f] = cols[i];
      });
      // 多出来的列拼进备注，避免丢数据
      if (cols.length > fields.length) {
        const extra = cols.slice(fields.length).filter(Boolean).join(' ');
        if (extra) rec.note = rec.note ? `${rec.note} ${extra}` : extra;
      }
      const email = rec.email?.toLowerCase();
      if (!email || !email.includes('@')) {
        invalid.push({ line: line.slice(0, 120), reason: '邮箱缺失或格式不正确' });
        continue;
      }
      if (seen.has(email)) {
        invalid.push({ line: line.slice(0, 120), reason: '文本内重复' });
        continue;
      }
      seen.add(email);
      rows.push({
        email,
        password: rec.password,
        emailPassword: rec.emailPassword,
        token: rec.token,
        note: rec.note,
      });
    }

    if (!rows.length) {
      return { total: lines.length, created: 0, duplicated: [], invalid, batchTag: null };
    }

    // 与库里已有邮箱（含回收站）比对
    const existing = await this.prisma.vaultAccount.findMany({
      where: { email: { in: rows.map((r) => r.email) } },
      select: { email: true },
    });
    const existingSet = new Set(existing.map((e) => e.email));
    const duplicated = rows.filter((r) => existingSet.has(r.email)).map((r) => r.email);
    const fresh = rows.filter((r) => !existingSet.has(r.email));

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const batchTag = `B${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    let created = 0;
    if (fresh.length) {
      const r = await this.prisma.vaultAccount.createMany({
        data: fresh.map((row) => ({
          email: row.email,
          passwordEnc: row.password ? encryptString(row.password) : null,
          emailPasswordEnc: row.emailPassword ? encryptString(row.emailPassword) : null,
          tokenEnc: row.token ? encryptString(row.token) : null,
          note: row.note?.slice(0, 500) || null,
          groupId: dto.groupId ?? null,
          status: dto.status ?? 'AVAILABLE',
          tags: dto.tags?.trim() || null,
          batchTag,
        })),
        skipDuplicates: true,
      });
      created = r.count;
    }

    await this.audit.fromReq(req, 'VAULT_IMPORT', {
      detail: {
        batchTag,
        total: lines.length,
        created,
        duplicated: duplicated.length,
        invalid: invalid.length,
      },
    });

    return {
      total: lines.length,
      created,
      duplicated: duplicated.slice(0, 50),
      duplicatedCount: duplicated.length,
      invalid: invalid.slice(0, 50),
      invalidCount: invalid.length,
      batchTag: created ? batchTag : null,
    };
  }

  // ─────────────────────── 导出 ───────────────────────

  async exportAccounts(dto: ExportVaultDto, req: Request) {
    const separator = dto.separator || '----';
    let rows: any[];
    if (dto.ids?.length) {
      rows = await this.prisma.vaultAccount.findMany({
        where: { id: { in: Array.from(new Set(dto.ids)) } },
        orderBy: { id: 'asc' },
      });
    } else {
      rows = await this.prisma.vaultAccount.findMany({
        where: this.buildWhere(dto),
        orderBy: { id: 'asc' },
        take: 5000,
      });
    }
    if (!rows.length) throw new BadRequestException('没有可导出的账号');

    const lines = rows.map((row) =>
      dto.fields
        .map((f) => {
          switch (f) {
            case 'email':
              return row.email;
            case 'password':
              return row.passwordEnc ? decryptString(row.passwordEnc) : '';
            case 'emailPassword':
              return row.emailPasswordEnc ? decryptString(row.emailPasswordEnc) : '';
            case 'token':
              return row.tokenEnc ? decryptString(row.tokenEnc) : '';
            case 'status':
              return row.status;
            case 'tags':
              return row.tags || '';
            case 'note':
              return row.note || '';
            default:
              return '';
          }
        })
        .join(separator),
    );

    const withSecrets = dto.fields.some((f) =>
      ['password', 'emailPassword', 'token'].includes(f),
    );
    if (withSecrets) {
      await this.logEvents(
        rows.map((r) => r.id),
        'EXPORT',
        dto.fields.join(','),
        req,
      );
    }
    await this.audit.fromReq(req, 'VAULT_EXPORT', {
      detail: { count: rows.length, fields: dto.fields },
    });

    return { count: rows.length, text: lines.join('\n') };
  }

  // ─────────────────────── 有效性检测 ───────────────────────

  private async checkAndSave(id: number): Promise<{
    id: number;
    email: string;
    result: string;
    message: string;
  }> {
    const row = await this.prisma.vaultAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('账号不存在');

    if (!row.tokenEnc) {
      await this.prisma.vaultAccount.update({
        where: { id },
        data: {
          checkResult: 'ERROR',
          checkMessage: '未录入 Token，无法检测',
          lastCheckAt: new Date(),
        },
      });
      return { id, email: row.email, result: 'ERROR', message: '未录入 Token，无法检测' };
    }

    const check = await checkCursorToken(decryptString(row.tokenEnc));
    await this.prisma.vaultAccount.update({
      where: { id },
      data: {
        checkResult: check.result,
        checkMessage: check.message.slice(0, 255),
        membershipType: check.membershipType,
        planUsedCents: check.planUsedCents,
        planLimitCents: check.planLimitCents,
        planPercent: check.planPercent,
        lastCheckAt: new Date(),
      },
    });
    return { id, email: row.email, result: check.result, message: check.message };
  }

  async checkOne(id: number, req: Request) {
    const result = await this.checkAndSave(id);
    await this.logEvent(id, 'CHECK', `${result.result}: ${result.message}`.slice(0, 255), req);
    return { ...result, account: await this.get(id) };
  }

  async checkBatch(dto: CheckBatchVaultDto, req: Request) {
    const ids = Array.from(new Set(dto.ids));
    const results: Array<{ id: number; email: string; result: string; message: string }> = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          results.push(await this.checkAndSave(id));
        } catch (e: any) {
          results.push({ id, email: '', result: 'ERROR', message: e?.message || '检测失败' });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CHECK_CONCURRENCY, ids.length) }, () => worker()),
    );

    const ok = results.filter((r) => r.result === 'VALID').length;
    const invalid = results.filter((r) => r.result === 'INVALID').length;
    const error = results.filter((r) => r.result === 'ERROR').length;

    await this.logEvents(ids, 'CHECK', '批量检测', req);
    await this.audit.fromReq(req, 'VAULT_CHECK_BATCH', {
      detail: { total: ids.length, ok, invalid, error },
    });
    return { total: ids.length, ok, invalid, error, results };
  }

  // ─────────────────────── 详细用量报告 ───────────────────────

  /**
   * 拉取账号的完整 Cursor 用量报告（会员、账期、套餐/按需消费、模型分布、逐条明细）。
   * 复用额度号池的 CursorUsageService，但账号库不涉及计价，只展示用量本身。
   * 顺带把关键快照写回账号，让列表的检测列同步刷新。
   */
  async usageReport(id: number, req: Request) {
    const row = await this.prisma.vaultAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('账号不存在');
    if (!row.tokenEnc) throw new BadRequestException('该账号未录入 Token，无法查询用量');

    const report = await this.usage.queryReport(decryptString(row.tokenEnc));

    // 写回快照（失败不影响返回报告）
    try {
      await this.prisma.vaultAccount.update({
        where: { id },
        data: {
          checkResult: 'VALID',
          checkMessage: '用量查询成功',
          membershipType: report.membershipType,
          planUsedCents: report.includedCostCents,
          planLimitCents: report.includedLimitCents,
          planPercent: report.totalPercentUsed ?? null,
          lastCheckAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`vault usage snapshot write failed: ${(e as Error).message}`);
    }

    await this.logEvent(id, 'USAGE', report.membershipType || null, req);
    await this.audit.fromReq(req, 'VAULT_USAGE', { target: row.email });
    return report;
  }
}
