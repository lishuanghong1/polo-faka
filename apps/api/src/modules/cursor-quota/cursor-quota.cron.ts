import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CursorQuotaService } from './cursor-quota.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 额度号池定时刷新：每分钟 tick，按设置间隔执行（默认 60 分钟）。
 * SiteSetting key: cursor_quota_refresh_minutes（0 = 关闭）
 */
@Injectable()
export class CursorQuotaCron {
  private readonly logger = new Logger(CursorQuotaCron.name);
  private lastRun = 0;
  private running = false;

  constructor(
    private readonly svc: CursorQuotaService,
    private readonly prisma: PrismaService,
  ) {}

  @Interval(60_000)
  async tick() {
    if (this.running) return;
    const minutes = await this.getRefreshMinutes();
    if (minutes <= 0) return;
    const now = Date.now();
    if (now - this.lastRun < minutes * 60_000) return;

    this.running = true;
    this.lastRun = now;
    try {
      const r = await this.svc.refreshAll();
      this.logger.log(`额度号池定时刷新：共 ${r.total}，成功 ${r.ok}，失败 ${r.failed}`);
    } catch (e: any) {
      this.logger.warn(`额度号池定时刷新失败：${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  private async getRefreshMinutes(): Promise<number> {
    try {
      const row = await this.prisma.siteSetting.findUnique({
        where: { key: 'cursor_quota_refresh_minutes' },
      });
      if (row?.value !== undefined && row.value !== '') {
        const n = Number(row.value);
        return Number.isFinite(n) ? n : 60;
      }
    } catch {
      // ignore
    }
    return Number(process.env.CURSOR_QUOTA_REFRESH_MINUTES || 60);
  }
}
