import { Injectable, Logger, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Admin IP 白名单。
 *
 * 配置：环境变量 ADMIN_IP_ALLOWLIST="1.2.3.4,10.0.0.0/8,2001:db8::/32"
 * - 留空 = 不限制（仅依赖 JWT + ADMIN 角色守卫）
 * - 支持：单个 IPv4/IPv6、CIDR
 *
 * 范围：仅对 /admin/* 路径生效，避免误伤公开接口。
 */
@Injectable()
export class AdminIpAllowlistMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AdminIpAllowlistMiddleware.name);
  private rules: Array<(ip: string) => boolean> = [];
  private raw: string = '';

  constructor() {
    this.reload();
  }

  reload() {
    const raw = (process.env.ADMIN_IP_ALLOWLIST || '').trim();
    this.raw = raw;
    if (!raw) {
      this.rules = [];
      return;
    }
    const rules: Array<(ip: string) => boolean> = [];
    for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const rule = buildRule(item);
      if (rule) rules.push(rule);
      else this.logger.warn(`Invalid ADMIN_IP_ALLOWLIST entry: ${item}`);
    }
    this.rules = rules;
    this.logger.log(`Admin IP allowlist loaded: ${rules.length} rules from "${raw}"`);
  }

  use(req: Request, _res: Response, next: NextFunction) {
    if (!this.rules.length) return next();
    if (!isAdminPath(req.path)) return next();

    const ip = extractClientIp(req);
    if (!ip) {
      this.logger.warn(`admin request without resolvable IP, path=${req.path}`);
      return next(new ForbiddenException('无法识别来源 IP'));
    }
    const ok = this.rules.some((r) => r(ip));
    if (!ok) {
      this.logger.warn(`Admin IP blocked: ${ip} → ${req.method} ${req.path}`);
      return next(new ForbiddenException(`你的 IP ${ip} 不在管理员白名单中`));
    }
    next();
  }
}

/**
 * 是否属于"后台路径"。
 * 注意：写入/敏感操作走的不只是 /admin/*，还包括：
 *   - /pool/accounts*    号池管理
 *   - /card-keys*        卡密管理
 *   - /users*            用户管理（balance / update / list）
 *   - /site-settings/all 设置详情
 *   - POST /site-settings 修改设置
 *   - /products POST/PUT/DELETE  商品管理
 *   - /categories POST/PUT/DELETE
 *   - /announcements POST/PUT/DELETE
 *   - /feedbacks GET     反馈列表
 * 为了简单，凡是匹配以下任一前缀都强制白名单。其它公开接口（/products GET, /orders POST 等）放行。
 */
const ADMIN_PATH_PREFIXES = [
  '/admin/',
  '/api/admin/',
  '/pool/accounts',
  '/api/pool/accounts',
  '/card-keys',
  '/api/card-keys',
  '/users',
  '/api/users',
  '/admin/redeem-codes',
  '/api/admin/redeem-codes',
];

function isAdminPath(path: string): boolean {
  for (const p of ADMIN_PATH_PREFIXES) {
    if (path === p || path.startsWith(p + '/') || path.startsWith(p)) return true;
  }
  // /site-settings/all 是 admin 用，但 /site-settings/public 不是
  if (path === '/site-settings/all' || path === '/api/site-settings/all') return true;
  return false;
}

function extractClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim().replace(/^::ffff:/, '');
  }
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function buildRule(item: string): ((ip: string) => boolean) | null {
  if (item.includes('/')) {
    // CIDR
    const [base, prefixStr] = item.split('/');
    const prefix = Number(prefixStr);
    if (!Number.isFinite(prefix)) return null;
    const isV6 = base.includes(':');
    const baseBits = ipToBits(base, isV6);
    if (!baseBits) return null;
    const len = Math.min(prefix, isV6 ? 128 : 32);
    const baseSlice = baseBits.slice(0, len);
    return (ip: string) => {
      const target = ip.replace(/^::ffff:/, '');
      const targetIsV6 = target.includes(':');
      if (targetIsV6 !== isV6) return false;
      const bits = ipToBits(target, isV6);
      return bits != null && bits.slice(0, len) === baseSlice;
    };
  }
  // 单 IP
  const isV6 = item.includes(':');
  const itemBits = ipToBits(item, isV6);
  if (!itemBits) return null;
  return (ip: string) => {
    const target = ip.replace(/^::ffff:/, '');
    const targetIsV6 = target.includes(':');
    if (targetIsV6 !== isV6) return false;
    const bits = ipToBits(target, isV6);
    return bits === itemBits;
  };
}

function ipToBits(ip: string, v6: boolean): string | null {
  try {
    if (!v6) {
      const parts = ip.split('.').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      return parts.map((n) => n.toString(2).padStart(8, '0')).join('');
    }
    // IPv6 标准展开
    let parts: string[];
    if (ip.includes('::')) {
      const [a, b] = ip.split('::');
      const left = a ? a.split(':') : [];
      const right = b ? b.split(':') : [];
      const fill = Array(8 - left.length - right.length).fill('0');
      parts = [...left, ...fill, ...right];
    } else {
      parts = ip.split(':');
    }
    if (parts.length !== 8) return null;
    return parts.map((p) => parseInt(p || '0', 16).toString(2).padStart(16, '0')).join('');
  } catch {
    return null;
  }
}
