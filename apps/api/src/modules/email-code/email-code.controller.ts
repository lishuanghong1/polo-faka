import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { EmailCodeService } from './email-code.service';
import { Public } from '../../common/decorators/public.decorator';

class FetchCodeDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  time_range?: number;

  @IsOptional()
  @IsBoolean()
  clear_cache?: boolean;

  @IsOptional()
  @IsBoolean()
  mark_read?: boolean;

  @IsOptional()
  @IsString()
  mail_id?: string;
}

@ApiTags('email-code')
@Controller('email-code')
export class EmailCodeController {
  constructor(private svc: EmailCodeService) {}

  @Public()
  @Get('enabled')
  async enabled() {
    return { enabled: await this.svc.isEnabled() };
  }

  /**
   * 接收前端轮询请求；本接口直通三方 /openapi/v1/email-code。
   * 限流：单 IP 每 10 秒最多 5 次（兼顾客户端 3s 轮询）。
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 10_000 } })
  @Post('fetch')
  async fetch(@Body() body: FetchCodeDto) {
    return this.svc.fetchCode({
      email: body.email,
      timeRange: body.time_range,
      clearCache: body.clear_cache,
      markRead: body.mark_read,
      mailId: body.mail_id,
    });
  }
}
