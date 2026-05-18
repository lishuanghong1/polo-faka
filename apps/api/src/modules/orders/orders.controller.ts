import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private svc: OrdersService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser('sub') userId: number | undefined,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      undefined;
    return this.svc.create(dto, userId, ip);
  }

  /**
   * Mock 支付（仅开发用）。
   * 必须 ENABLE_MOCK_PAY=true 才启用；否则一律 403。
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':orderNo/mock-pay')
  mockPay(@Param('orderNo') orderNo: string) {
    if (process.env.ENABLE_MOCK_PAY !== 'true') {
      throw new ForbiddenException('Mock 支付未启用');
    }
    return this.svc.mockPay(orderNo);
  }

  /** 公开查询：订单号 + 可选 contact 校验 */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('query/:orderNo')
  query(@Param('orderNo') orderNo: string, @Query('contact') contact?: string) {
    return this.svc.query(orderNo, contact);
  }

  @ApiBearerAuth()
  @Get('mine')
  mine(
    @CurrentUser('sub') userId: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listMine(userId, Number(page) || 1, Number(pageSize) || 20);
  }
}
