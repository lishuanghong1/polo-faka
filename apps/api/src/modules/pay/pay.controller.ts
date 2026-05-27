import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from '../orders/orders.service';
import { Public } from '../../common/decorators/public.decorator';

/** 仅允许本站相对路径，防止 open redirect 注入到支付返回 url */
function sanitizeReturn(u?: string): string {
  if (u && /^\/(?!\/)/.test(u)) return u;
  return '/';
}

/**
 * Mock 支付聚合入口（仅本地/调试用）。
 * - 必须设置 ENABLE_MOCK_PAY=true 才生效，否则所有路由都返回 403。
 * - 真实生产环境走 /pay/alipay/*。
 */
@ApiTags('pay')
@Controller('pay')
export class PayController {
  constructor(private orders: OrdersService) {}

  private assertEnabled() {
    if (process.env.ENABLE_MOCK_PAY !== 'true') {
      throw new ForbiddenException('Mock 支付未启用');
    }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('create/:orderNo')
  create(@Param('orderNo') orderNo: string, @Query('return') returnUrl?: string) {
    this.assertEnabled();
    return {
      orderNo,
      provider: 'mock',
      payUrl: `/mock-pay?orderNo=${encodeURIComponent(orderNo)}&return=${encodeURIComponent(sanitizeReturn(returnUrl))}`,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('notify/mock')
  notify(@Body() body: { orderNo: string }) {
    this.assertEnabled();
    return this.orders.mockPay(body.orderNo);
  }
}
