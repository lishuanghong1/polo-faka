import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { CursorSellService } from './cursor-sell.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

class TeamRedeemDto {
  @IsString()
  @IsNotEmpty({ message: '请填写兑换码' })
  @MaxLength(128, { message: '兑换码过长' })
  code!: string;
}

@ApiTags('cursor-sell')
@Controller('cursor-sell')
export class CursorSellController {
  constructor(
    private svc: CursorSellService,
    private audit: AuditService,
  ) {}

  /** 前台据此决定是否展示「Team 兑换」选项 */
  @Public()
  @Get('enabled')
  async enabled() {
    return { enabled: await this.svc.isEnabled() };
  }

  /**
   * Team 兑换：把用户输入的充值卡码交给上游「兑换充值卡」接口。
   * 公开接口 + 限流；成功/失败都写审计，便于排查与发现撞库。
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('redeem')
  async redeem(
    @Body() body: TeamRedeemDto,
    @Req() req: Request,
    @CurrentUser() user?: JwtPayload,
  ) {
    const code = body.code.trim();
    try {
      const data = await this.svc.redeemWalletCard(code);
      const { balanceCents, ...rest } = data;
      const amountCents = Number(rest.amountCents ?? 0);
      void this.audit.fromReq(req, AuditActions.TEAM_REDEEM, {
        target: code,
        detail: { ok: true, amountCents, balanceCents },
      });
      // 渠道钱包余额是本站的经营数据，只回给管理员
      const isAdmin = user?.role === 'ADMIN';
      return {
        ...rest,
        code,
        amountCents,
        amount: amountCents / 100,
        redeemedAt: new Date().toISOString(),
        ...(isAdmin && typeof balanceCents === 'number'
          ? { balanceCents, balance: balanceCents / 100 }
          : {}),
      };
    } catch (e) {
      const err = e as { errorCode?: string; message?: string };
      void this.audit.fromReq(req, AuditActions.TEAM_REDEEM, {
        target: code,
        detail: { ok: false, errorCode: err.errorCode, error: err.message },
      });
      throw e;
    }
  }

  /** 后台：查售号钱包余额，用于校验 API Key 配置是否正确 */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('wallet')
  async wallet() {
    const { balanceCents } = await this.svc.getWallet();
    return { balanceCents, balance: balanceCents / 100 };
  }
}
