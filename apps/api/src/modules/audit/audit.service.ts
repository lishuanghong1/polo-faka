import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction } from './audit.constants';

export interface AuditInput {
  action: AuditAction | string;
  target?: string | null;
  detail?: any;
  actorId?: number | null;
  actor?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

function getIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || undefined;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private prisma: PrismaService) {}

  /**
   * 直接传入参数。任何抛错都吞掉，不影响业务。
   */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          actor: input.actor ?? 'system',
          action: input.action,
          target: input.target ?? null,
          detail: input.detail ?? undefined,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`audit.record failed: ${(e as Error).message}`);
    }
  }

  /**
   * 便捷方法：从请求里直接抽 actor / ip / ua。
   * 如果 req.user 不存在（未登录场景），actor 用 fallback。
   */
  async fromReq(
    req: Request,
    action: AuditAction | string,
    options: {
      target?: string | null;
      detail?: any;
      actorFallback?: string;
    } = {},
  ): Promise<void> {
    const user = (req as any).user;
    await this.record({
      action,
      target: options.target,
      detail: options.detail,
      actorId: user?.sub ?? null,
      actor: user?.username ?? options.actorFallback ?? 'guest',
      ip: getIp(req),
      userAgent: req.headers['user-agent']?.toString(),
    });
  }

  /** 列表查询 */
  async list(query: {
    page?: number;
    pageSize?: number;
    action?: string;
    actor?: string;
    target?: string;
    actorId?: number;
    since?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const where: any = {};
    if (query.action) where.action = query.action;
    if (query.actor) where.actor = { contains: query.actor };
    if (query.target) where.target = { contains: query.target };
    if (query.actorId) where.actorId = query.actorId;
    if (query.since) where.createdAt = { gte: new Date(query.since) };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  /** 唯一 action 列表（给前端做筛选下拉） */
  async distinctActions() {
    const rows = await this.prisma.auditLog.findMany({
      select: { action: true },
      distinct: ['action'],
    });
    return rows.map((r) => r.action);
  }
}
