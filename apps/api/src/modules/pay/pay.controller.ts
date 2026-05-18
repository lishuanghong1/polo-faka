import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrdersService } from '../orders/orders.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * 支付聚合入口。真实生产环境替换为：易支付 / 虎皮椒 / USDT / 当面付。
 * 这里 v1 仅做 Mock：前端拉起"假支付"页面，点击"确认支付"调 mock-pay 回调。
 */
@ApiTags('pay')
@Controller('pay')
export class PayController {
  constructor(private orders: OrdersService) {}

  /** 创建支付：返回前端要跳转的支付链接（mock 模式下是本地页面） */
  @Public()
  @Get('create/:orderNo')
  create(@Param('orderNo') orderNo: string, @Query('return') returnUrl?: string) {
    return {
      orderNo,
      provider: 'mock',
      payUrl: `/mock-pay?orderNo=${encodeURIComponent(orderNo)}&return=${encodeURIComponent(returnUrl || '/')}`,
    };
  }

  /** Mock 通知：实际是易支付 / 微信 / 支付宝的异步 notify_url */
  @Public()
  @Post('notify/mock')
  notify(@Body() body: { orderNo: string }) {
    return this.orders.mockPay(body.orderNo);
  }
}
