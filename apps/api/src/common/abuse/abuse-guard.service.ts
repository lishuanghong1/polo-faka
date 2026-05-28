import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

const PREFIX = 'abuse';
const BLACKLIST_PREFIX = 'blacklist:ip:';

export interface BumpOptions {
  /** 计数窗口（秒），默认 600 = 10 分钟 */
  window?: number;
  /** 累计达到该值即拉黑（默认 5） */
  threshold?: number;
  /** 拉黑时长（秒），默认 86400 = 24 小时 */
  blockSeconds?: number;
}

/**
 * IP 滥用防御服务。
 * - 提供 IP 黑名单的设置 / 查询 / 解封
 * - 提供"计数 + 自动拉黑"原语（基于 Redis INCR + TTL）
 * - 提供"短时间内同 IP 同事件去重"标记，用于压制审计日志噪声
 *
 * 黑名单存储：Redis key `blacklist:ip:<ip>`，value 为拉黑原因，过期即自动解封。
 */
@Injectable()
export class AbuseGuardService {
  private readonly logger = new Logger(AbuseGuardService.name);

  constructor(@Inject(REDIS_CLIENT) private redis: Redis) {}

  /** 当前 IP 是否在黑名单。Redis 异常时 fail-open（不阻塞业务） */
  async isBlocked(ip: string | null | undefined): Promise<boolean> {
    if (!ip) return false;
    try {
      const v = await this.redis.exists(`${BLACKLIST_PREFIX}${ip}`);
      return v > 0;
    } catch (e) {
      this.logger.warn(`isBlocked redis error: ${(e as Error).message}`);
      return false;
    }
  }

  /** 拉黑 IP（覆盖式 set + TTL） */
  async block(ip: string, seconds = 86400, reason = 'manual'): Promise<void> {
    try {
      await this.redis.set(
        `${BLACKLIST_PREFIX}${ip}`,
        `${Date.now()}|${reason.slice(0, 200)}`,
        'EX',
        seconds,
      );
      this.logger.warn(`IP blocked: ${ip} (${seconds}s, reason=${reason})`);
    } catch (e) {
      this.logger.error(`block redis error: ${(e as Error).message}`);
    }
  }

  /** 解封 IP */
  async unblock(ip: string): Promise<void> {
    try {
      await this.redis.del(`${BLACKLIST_PREFIX}${ip}`);
      this.logger.log(`IP unblocked: ${ip}`);
    } catch (e) {
      this.logger.error(`unblock redis error: ${(e as Error).message}`);
    }
  }

  /** 列出当前所有黑名单（带剩余 TTL 和原因，供后台展示） */
  async listBlocked(): Promise<
    Array<{ ip: string; reason: string; createdAt: number; ttl: number }>
  > {
    try {
      const keys = await this.redis.keys(`${BLACKLIST_PREFIX}*`);
      if (!keys.length) return [];
      const items = await Promise.all(
        keys.map(async (key) => {
          const ip = key.slice(BLACKLIST_PREFIX.length);
          const [val, ttl] = await Promise.all([
            this.redis.get(key),
            this.redis.ttl(key),
          ]);
          const [tsStr, ...reasonParts] = (val || '').split('|');
          const createdAt = Number(tsStr) || 0;
          const reason = reasonParts.join('|') || 'unknown';
          return { ip, reason, createdAt, ttl: Math.max(0, ttl) };
        }),
      );
      return items.sort((a, b) => b.createdAt - a.createdAt);
    } catch (e) {
      this.logger.error(`listBlocked redis error: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 累加滥用计数。达到阈值即自动拉黑该 IP。
   * 返回值告知调用方当前计数 + 是否触发了拉黑。
   *
   * 典型用法：
   *   const { blocked } = await abuse.bumpAndCheck(ip, 'alipay_notify_malformed', {
   *     window: 300, threshold: 5, blockSeconds: 86400,
   *   });
   */
  async bumpAndCheck(
    ip: string,
    bucket: string,
    opts: BumpOptions = {},
  ): Promise<{ count: number; blocked: boolean }> {
    const window = opts.window ?? 600;
    const threshold = opts.threshold ?? 5;
    const blockSeconds = opts.blockSeconds ?? 86400;
    const key = `${PREFIX}:${bucket}:${ip}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, window);
      if (count >= threshold) {
        await this.block(ip, blockSeconds, `auto:${bucket}:${count}`);
        return { count, blocked: true };
      }
      return { count, blocked: false };
    } catch (e) {
      this.logger.warn(`bumpAndCheck redis error: ${(e as Error).message}`);
      return { count: 0, blocked: false };
    }
  }

  /**
   * 去重标记：同 IP 同 bucket 在 windowSeconds 内只允许"通过"一次，
   * 后续返回 false（用于压制审计日志噪声）。
   * 第一次调用返回 true。
   */
  async shouldRecord(
    ip: string,
    bucket: string,
    windowSeconds = 60,
  ): Promise<boolean> {
    const key = `${PREFIX}:dedup:${bucket}:${ip}`;
    try {
      const set = await this.redis.set(key, '1', 'EX', windowSeconds, 'NX');
      return set === 'OK';
    } catch {
      return true; // Redis 异常时回退到「记录」
    }
  }
}
