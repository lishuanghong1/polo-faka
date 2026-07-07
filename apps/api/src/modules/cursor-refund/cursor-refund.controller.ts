import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CursorRefundService } from './cursor-refund.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

@ApiTags('admin-cursor-refund')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/cursor-refund')
export class CursorRefundController {
  constructor(
    private svc: CursorRefundService,
    private audit: AuditService,
  ) {}

  /** 是否已配置好（前端据此提示） */
  @Post('status')
  async status() {
    const cfg = await this.svc.getConfig();
    return { ready: cfg.enabled, teamId: cfg.teamId, hasOwner: !!cfg.ownerToken };
  }

  /**
   * 手动退款：粘贴一个或多个 token（user_xxx::JWT / 含 WorkosCursorSessionToken 的 cookie 均可），
   * 逐个执行「团队邀请按比例退款」，返回每个的结果。
   */
  @Post('manual')
  async manual(@Body() body: { tokens?: string[]; token?: string }, @Req() req: Request) {
    let tokens = Array.isArray(body?.tokens) ? body.tokens : [];
    if (body?.token) tokens = [body.token, ...tokens];
    tokens = tokens.map((t) => (t || '').trim()).filter(Boolean);
    if (!tokens.length) throw new BadRequestException('请粘贴至少一个 token');
    if (tokens.length > 20) throw new BadRequestException('单次最多 20 个');

    const results = await this.svc.refundMany(tokens);
    const okCount = results.filter((r) => r.ok).length;
    this.audit.fromReq(req, AuditActions.WAREHOUSE_REFUND_RUN, {
      target: `manual:${tokens.length}`,
      detail: { total: tokens.length, ok: okCount },
    });
    return {
      total: tokens.length,
      ok: okCount,
      failed: results.length - okCount,
      results: results.map((r) => ({
        email: r.email,
        ok: r.ok,
        amount: r.amount,
        prevMembership: r.prevMembership,
        finalMembership: r.finalMembership,
        error: r.error,
      })),
    };
  }
}
