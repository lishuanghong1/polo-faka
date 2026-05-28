import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../decorators/roles.decorator';
import { AbuseGuardService } from './abuse-guard.service';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('abuse')
@ApiBearerAuth()
@Controller('admin/abuse')
export class AbuseAdminController {
  constructor(
    private readonly abuse: AbuseGuardService,
    private readonly prisma: PrismaService,
  ) {}

  /** 当前所有黑名单 IP（含剩余 TTL） */
  @Roles('ADMIN')
  @Get('blocked')
  async listBlocked() {
    return this.abuse.listBlocked();
  }

  /** 手动拉黑 IP，默认 24h */
  @Roles('ADMIN')
  @Post('block')
  async block(@Body() body: { ip: string; seconds?: number; reason?: string }) {
    const ip = (body.ip || '').trim();
    if (!ip) return { ok: false };
    await this.abuse.block(
      ip,
      Number(body.seconds) || 86400,
      body.reason || 'manual',
    );
    return { ok: true };
  }

  /** 解封 IP */
  @Roles('ADMIN')
  @Delete('block/:ip')
  async unblock(@Param('ip') ip: string) {
    await this.abuse.unblock(decodeURIComponent(ip));
    return { ok: true };
  }

  /**
   * IP 画像：聚合该 IP 在审计日志、订单、用户表中的所有痕迹。
   * 用于回答："这个攻击者还做过什么 / 关联了哪些账号"
   */
  @Roles('ADMIN')
  @Get('profile/:ip')
  async profile(@Param('ip') ipRaw: string, @Query('days') daysQ?: string) {
    const ip = decodeURIComponent(ipRaw).trim();
    const days = Math.min(90, Math.max(1, Number(daysQ) || 30));
    const since = new Date(Date.now() - days * 86400_000);

    // ── 审计日志聚合 ──
    const logs = await this.prisma.auditLog.findMany({
      where: { ip, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // 关联到账号（actorId 不为 null 说明他登录过）
    const actorIds = Array.from(
      new Set(logs.map((l) => l.actorId).filter((v): v is number => !!v)),
    );
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            username: true,
            email: true,
            createdAt: true,
            balance: true,
            role: true,
          },
        })
      : [];

    // ── 按动作分布 ──
    const actionCount = new Map<string, number>();
    const uaCount = new Map<string, number>();
    for (const l of logs) {
      actionCount.set(l.action, (actionCount.get(l.action) || 0) + 1);
      if (l.userAgent) uaCount.set(l.userAgent, (uaCount.get(l.userAgent) || 0) + 1);
    }

    // ── 最近请求时间分布（按小时桶） ──
    const hourBuckets = new Map<string, number>();
    for (const l of logs) {
      const t = new Date(l.createdAt);
      const bucket = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:00`;
      hourBuckets.set(bucket, (hourBuckets.get(bucket) || 0) + 1);
    }

    // ── 关联订单（IP 字段可能不存在；只能通过 actorId 关联） ──
    const localOrders = actorIds.length
      ? await this.prisma.order.findMany({
          where: { userId: { in: actorIds }, createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            orderNo: true,
            status: true,
            payAmount: true,
            createdAt: true,
            productTitle: true,
          },
        })
      : [];
    const forgeOrders = actorIds.length
      ? await this.prisma.forgeOrder.findMany({
          where: { userId: { in: actorIds }, createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            orderNo: true,
            status: true,
            totalAmount: true,
            payAmount: true,
            createdAt: true,
            typeName: true,
          },
        })
      : [];

    return {
      ip,
      days,
      blocked: await this.abuse.isBlocked(ip),
      stats: {
        totalRequests: logs.length,
        firstSeen: logs.length ? logs[logs.length - 1].createdAt : null,
        lastSeen: logs.length ? logs[0].createdAt : null,
        distinctActions: actionCount.size,
        distinctUserAgents: uaCount.size,
        linkedAccounts: users.length,
      },
      actions: Array.from(actionCount.entries())
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count),
      userAgents: Array.from(uaCount.entries())
        .map(([ua, count]) => ({ ua, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      timeline: Array.from(hourBuckets.entries())
        .map(([t, count]) => ({ t, count }))
        .sort((a, b) => (a.t < b.t ? -1 : 1)),
      linkedUsers: users,
      linkedOrders: { local: localOrders, forge: forgeOrders },
      recentLogs: logs.slice(0, 30).map((l) => ({
        id: l.id,
        action: l.action,
        target: l.target,
        actor: l.actor,
        userAgent: l.userAgent,
        detail: l.detail,
        createdAt: l.createdAt,
      })),
    };
  }
}
