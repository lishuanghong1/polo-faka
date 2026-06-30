import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AizhpOpenService } from './aizhp-open.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

class FetchCodeDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsOptional()
  since?: number;
}

class SubmitRefundDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: '请选择档位' })
  plan!: string;

  @IsOptional()
  @IsString()
  refund_method?: string;
}

/** 前台用户申请退款的 DTO（只需邮箱，档位自动识别） */
class UserRefundDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;
}

@ApiTags('aizhp-open')
@Controller('aizhp-open')
export class AizhpOpenController {
  constructor(private svc: AizhpOpenService) {}

  /** 测试连接（Admin） */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('ping')
  ping() {
    return this.svc.ping();
  }

  /** 是否启用 */
  @Public()
  @Get('enabled')
  async enabled() {
    return { enabled: await this.svc.isEnabled() };
  }

  /** 账号列表（Admin） */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('accounts')
  listAccounts(
    @Query('filter') filter?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const f = (['all', 'used', 'unused'].includes(filter || '') ? filter : 'all') as 'all' | 'used' | 'unused';
    return this.svc.listAccounts(f, Number(page) || 1, Number(pageSize) || 20);
  }

  /**
   * 前端接码轮询（Public，限流：单 IP 每 10 秒 5 次）。
   * 前端每 3s 调一次，since 传触发验证码时的毫秒时间戳。
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 10_000 } })
  @Post('code')
  async fetchCode(@Body() body: FetchCodeDto) {
    const resp = await this.svc.fetchCode(body.email, body.since);
    if (resp.success && resp.code) {
      return { ok: true, found: true, verification_code: resp.code };
    }
    // 未收到码 → 让前端继续轮询
    return {
      ok: true,
      found: false,
      message: resp.error || '正在查收邮件…',
      terminal: resp.success === false && resp.error?.includes('不存在'),
    };
  }

  /** 退款额度（Admin） */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('quotas')
  getQuotas() {
    return this.svc.getQuotas();
  }

  /** 发起退款（Admin） */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('refund')
  submitRefund(@Body() body: SubmitRefundDto) {
    return this.svc.submitRefund(body.email, body.plan, body.refund_method);
  }

  /** 退款记录列表（Admin，带本地订单号） */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('refunds')
  listRefunds(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listRefundsEnriched(Number(page) || 1, Number(pageSize) || 50);
  }

  /** 查单条退款状态（Admin） */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('refunds/:id')
  getRefund(@Param('id') id: string) {
    return this.svc.getRefund(Number(id));
  }

  // ====== 前台用户自助退款 ======

  /**
   * 前台用户申请退款（Public，限流）。
   * 校验：邮箱必须对应一条 [aizhp] 标记且已售出的卡密，确保是本站购买的账号。
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('user-refund')
  async userRefund(@Body() body: UserRefundDto) {
    return this.svc.userRefund(body.email);
  }
}
