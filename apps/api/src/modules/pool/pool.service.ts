import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import axios from 'axios';
import dayjs from 'dayjs';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptString, encryptString, isEncrypted, maskSecret } from '../../common/crypto.util';

@Injectable()
export class PoolService {
  private readonly logger = new Logger(PoolService.name);

  constructor(private prisma: PrismaService) {
    // 启动时延迟执行一次明文 → 密文迁移
    setTimeout(() => {
      this.migrateEncryptAllTokens().catch((e) => {
        this.logger.error(`migrateEncryptAllTokens failed: ${e?.message ?? e}`);
      });
    }, 2000);
  }

  /** 列表项展示用：脱敏 + 不返回密文 */
  private toListItem(a: any) {
    let plain = '';
    try {
      plain = decryptString(a.token);
    } catch {
      /* 解密失败 → 视为空 */
    }
    return {
      id: a.id,
      label: a.label,
      type: a.type,
      email: a.email,
      tokenMasked: maskSecret(plain),
      totalQuota: a.totalQuota,
      usedQuota: a.usedQuota,
      status: a.status,
      lastCheckAt: a.lastCheckAt,
      note: a.note,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  // ====== 账号池（管理员侧） ======

  async listAccounts(page = 1, pageSize = 30) {
    const [total, raw] = await this.prisma.$transaction([
      this.prisma.poolAccount.count(),
      this.prisma.poolAccount.findMany({
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: raw.map((a) => this.toListItem(a)) };
  }

  /** 单独 reveal 接口：返回明文 token（仅 ADMIN，会写日志） */
  async revealToken(id: number, operator: { id?: number; username?: string }) {
    const a = await this.prisma.poolAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('账号不存在');
    let token = '';
    try {
      token = decryptString(a.token);
    } catch (e) {
      throw new ForbiddenException('解密失败：密钥不正确或密文损坏');
    }
    this.logger.warn(
      `[AUDIT] reveal pool token id=${id} label=${a.label} by user=${operator.username ?? operator.id ?? 'unknown'}`,
    );
    return { id: a.id, label: a.label, token };
  }

  /** 允许 ADMIN 编辑的字段白名单（防止透传 createdAt / id / 内部字段） */
  private pickAccountFields(data: any) {
    const out: any = {};
    if (typeof data?.label === 'string') out.label = data.label.slice(0, 64);
    if (typeof data?.type === 'string') out.type = data.type.slice(0, 32);
    if (typeof data?.email === 'string') out.email = data.email.slice(0, 128);
    if (Number.isFinite(Number(data?.totalQuota))) out.totalQuota = Number(data.totalQuota);
    if (Number.isFinite(Number(data?.usedQuota))) out.usedQuota = Number(data.usedQuota);
    if (typeof data?.status === 'string') out.status = data.status.slice(0, 16);
    if (typeof data?.note === 'string') out.note = data.note.slice(0, 500);
    return out;
  }

  async createAccount(data: any) {
    const { token } = data;
    if (!token) throw new NotFoundException('token 不能为空');
    if (typeof token !== 'string' || token.length > 10_000) {
      throw new NotFoundException('token 非法或过长');
    }
    const safe = this.pickAccountFields(data);
    return this.prisma.poolAccount
      .create({ data: { ...safe, token: encryptString(token) } })
      .then((a) => this.toListItem(a));
  }

  async updateAccount(id: number, data: any) {
    const { token } = data;
    const patch: any = this.pickAccountFields(data);
    if (token !== undefined && token !== null && token !== '') {
      if (typeof token !== 'string' || token.length > 10_000) {
        throw new NotFoundException('token 非法或过长');
      }
      patch.token = encryptString(token);
    }
    return this.prisma.poolAccount
      .update({ where: { id }, data: patch })
      .then((a) => this.toListItem(a));
  }

  removeAccount(id: number) {
    return this.prisma.poolAccount.delete({ where: { id } });
  }

  /** 用脚本/启动时把历史明文 token 一次性加密（迁移用） */
  async migrateEncryptAllTokens() {
    const all = await this.prisma.poolAccount.findMany();
    let count = 0;
    for (const a of all) {
      if (!isEncrypted(a.token)) {
        await this.prisma.poolAccount.update({
          where: { id: a.id },
          data: { token: encryptString(a.token) },
        });
        count++;
      }
    }
    if (count) this.logger.warn(`migrated ${count} pool tokens to encrypted form`);
    return { migrated: count };
  }

  // ====== 额度发放（用户侧） ======

  /** 用户提交自己的 Cursor Token，绑定到订单上 */
  async bindUserToken(orderNo: string, userToken: string) {
    const grant = await this.prisma.poolGrant.findUnique({ where: { orderNo } });
    if (!grant) throw new NotFoundException('未找到该订单的额度配额');
    return this.prisma.poolGrant.update({
      where: { orderNo },
      data: {
        userToken,
        startAt: grant.startAt ?? new Date(),
        endAt: grant.endAt ?? dayjs().add(grant.validityDays, 'day').toDate(),
        active: true,
      },
    });
  }

  /** 查询某个订单的额度使用情况（最新） */
  async queryQuota(orderNo: string) {
    const grant = await this.prisma.poolGrant.findUnique({
      where: { orderNo },
      include: { account: true },
    });
    if (!grant) throw new NotFoundException('订单无效');
    return {
      orderNo: grant.orderNo,
      quotaTotal: grant.quotaTotal,
      quotaUsed: grant.quotaUsed,
      quotaRemain: +(Number(grant.quotaTotal) - Number(grant.quotaUsed)).toFixed(4),
      startAt: grant.startAt,
      endAt: grant.endAt,
      active: grant.active,
      lastCheckAt: grant.lastCheckAt,
    };
  }

  /** 对所有 Pool 账号执行查询：模拟 Cursor 账单查询接口 */
  async refreshAllAccounts() {
    const accounts = await this.prisma.poolAccount.findMany();
    const results: any[] = [];
    for (const a of accounts) {
      try {
        const plainToken = decryptString(a.token);
        const info = await this.fetchCursorUsage(plainToken);
        await this.prisma.poolAccount.update({
          where: { id: a.id },
          data: {
            totalQuota: info.total,
            usedQuota: info.used,
            status:
              info.remain <= 0
                ? 'EXHAUSTED'
                : info.remain < 5
                  ? 'LOW_QUOTA'
                  : 'HEALTHY',
            lastCheckAt: new Date(),
          },
        });
        results.push({ id: a.id, ok: true, ...info });
      } catch (e: any) {
        await this.prisma.poolAccount.update({
          where: { id: a.id },
          data: { status: 'UNKNOWN', lastCheckAt: new Date() },
        });
        results.push({ id: a.id, ok: false, error: e.message });
      }
    }
    return results;
  }

  /**
   * 查询 Cursor 余额。
   * 这里**只给一个可替换的抽象**：真实接口需要你接 Cursor 的内部 API，
   * 不同时期协议不同，且涉及合规风险。默认实现返回 mock。
   */
  private async fetchCursorUsage(_token: string): Promise<{ total: number; used: number; remain: number }> {
    const endpoint = process.env.CURSOR_USAGE_ENDPOINT;
    if (!endpoint) {
      // mock：基础 20 + 奖励 ~ 45 = 65 刀，已用随机
      const total = 65;
      const used = Math.round(Math.random() * 60 * 100) / 100;
      return { total, used, remain: +(total - used).toFixed(2) };
    }
    const { data } = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${_token}` },
      timeout: 10000,
    });
    return {
      total: Number(data.total || 0),
      used: Number(data.used || 0),
      remain: Number(data.total || 0) - Number(data.used || 0),
    };
  }

  /** 一键激活：把用户的 Token 提交到外部激活服务（占位实现） */
  async activateUserToken(token: string, captcha?: string) {
    const endpoint = process.env.CURSOR_ACTIVATE_ENDPOINT;
    if (!endpoint) {
      // 本地 mock：直接返回成功
      await new Promise((r) => setTimeout(r, 800));
      return { ok: true, message: '激活成功（mock）', plan: 'ultra' };
    }
    const { data } = await axios.post(
      endpoint,
      { token, captcha },
      { timeout: 30000 },
    );
    return data;
  }
}
