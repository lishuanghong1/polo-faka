import {
  BadRequestException,
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CursorToolsService } from './cursor-tools.service';

/**
 * Cursor 工具相关接口。
 * 当前仅提供 token 在线验证 / 信息查询。
 *
 * 安全：
 * - Token 仅在此请求生命周期内使用，不持久化、不写日志
 * - 严格限流（同一 IP 每分钟 6 次）防止被滥用为代理
 */
@ApiTags('tools/cursor')
@Controller('tools/cursor')
export class CursorToolsController {
  constructor(private svc: CursorToolsService) {}

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('inspect')
  async inspect(@Body() body: { token?: string }) {
    const token = (body?.token || '').trim();
    if (!token || token.length < 30 || token.length > 4096) {
      throw new BadRequestException('invalid token');
    }
    const result = await this.svc.inspect(token);
    return { success: true, data: result };
  }
}
