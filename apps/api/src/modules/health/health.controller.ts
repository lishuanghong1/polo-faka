import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * 健康检查端点 - 供 Docker / Caddy / 监控系统使用。
 * - GET /api/health         便宜的存活检查（公开但极简，不暴露内部信息）
 * - GET /api/health/ready   依赖就绪检查（仅 ADMIN，避免被扫描）
 *
 * Docker healthcheck 使用 /api/health，避免周期性 DB 查询消耗连接。
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  /** 极简存活检查 - 不下发任何进程/版本信息防探测 */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  liveness() {
    return { status: 'ok' };
  }

  /** 依赖就绪检查 - 仅 ADMIN，避免攻击者借此探测 DB/Redis 在不在 */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('ready')
  async readiness() {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    const t1 = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.mysql = { ok: true, latencyMs: Date.now() - t1 };
    } catch (e) {
      checks.mysql = { ok: false, error: (e as Error).message };
    }

    const t2 = Date.now();
    try {
      const pong = await this.redis.ping();
      checks.redis = { ok: pong === 'PONG', latencyMs: Date.now() - t2 };
    } catch (e) {
      checks.redis = { ok: false, error: (e as Error).message };
    }

    const m = process.memoryUsage();
    const memory = {
      rssMB: Math.round(m.rss / 1024 / 1024),
      heapUsedMB: Math.round(m.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(m.heapTotal / 1024 / 1024),
    };

    const allOk = Object.values(checks).every((c) => c.ok);
    if (!allOk) {
      throw new HttpException(
        { status: 'degraded', checks, memory },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', checks, memory };
  }
}
