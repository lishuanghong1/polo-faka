import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../decorators/roles.decorator';
import { AbuseGuardService } from './abuse-guard.service';

@ApiTags('abuse')
@ApiBearerAuth()
@Controller('admin/abuse')
export class AbuseAdminController {
  constructor(private readonly abuse: AbuseGuardService) {}

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
}
