import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { LoginDto, RegisterDto } from './dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('website-auth')
@Controller('website-auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private audit: AuditService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const r = await this.auth.register(dto);
    this.audit.fromReq(req, AuditActions.REGISTER, {
      target: `user:${r.user.id}`,
      actorFallback: dto.username,
    });
    return r;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    try {
      const r = await this.auth.login(dto);
      this.audit.fromReq(req, AuditActions.LOGIN_OK, {
        target: `user:${r.user.id}`,
        actorFallback: dto.username,
      });
      return r;
    } catch (e) {
      // 登录失败也写入，用于异常告警
      this.audit.record({
        action: AuditActions.LOGIN_FAIL,
        actor: dto.username,
        ip:
          (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          req.socket?.remoteAddress,
        userAgent: req.headers['user-agent']?.toString(),
        detail: { message: (e as Error).message },
      });
      throw e;
    }
  }

  @ApiBearerAuth()
  @Get('profile')
  profile(@CurrentUser('sub') userId: number) {
    return this.auth.profile(userId);
  }
}
