import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AbuseGuardService } from './abuse-guard.service';

/** 提取客户端 IP（CF / 反代 / 直连） */
function extractClientIp(req: Request): string | null {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.split(',')[0].trim().replace(/^::ffff:/, '');
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim().replace(/^::ffff:/, '');
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null;
}

/**
 * 全局 IP 黑名单中间件。
 * 命中黑名单的请求直接 403，连业务都不进入。
 * 健康检查接口不拦截，避免反代探活被误伤。
 */
@Injectable()
export class IpBlacklistMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IpBlacklistMiddleware.name);

  constructor(private readonly abuse: AbuseGuardService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // 健康检查放行（哪怕 IP 在黑名单也允许，避免反代误判服务宕机）
    if (req.path === '/health' || req.path === '/api/health') {
      return next();
    }
    const ip = extractClientIp(req);
    if (!ip) return next();
    const blocked = await this.abuse.isBlocked(ip);
    if (blocked) {
      this.logger.warn(
        `BLOCKED ${req.method} ${req.path} from ${ip} (UA=${(req.headers['user-agent'] || '').slice(0, 80)})`,
      );
      // 简短响应，不暴露原因，让攻击者无法精确探测
      res.status(403).json({ success: false, error: 'forbidden' });
      return;
    }
    next();
  }
}
