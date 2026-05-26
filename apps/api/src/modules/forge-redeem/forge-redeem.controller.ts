import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ForgeRedeemService } from './forge-redeem.service';
import { Public } from '../../common/decorators/public.decorator';
import { RedeemCheckDto, RedeemOrderDto } from './dto';

/**
 * 公开端点：访客直接访问（兑换流程）
 */
@ApiTags('forge-redeem')
@Controller('forge-redeem')
export class ForgeRedeemController {
  constructor(private svc: ForgeRedeemService) {}

  /** 查询兑换码状态 + 余额 + 可下单商品 */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('check')
  check(@Body() body: RedeemCheckDto) {
    return this.svc.checkCode(body.code);
  }

  /** 触发下单 */
  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('order')
  async order(@Body() body: RedeemOrderDto, @Req() req: Request) {
    return this.svc.createOrder({
      code: body.code,
      typeKey: body.typeKey,
      quantity: body.quantity,
      ip: req.ip,
    });
  }

  /** 公开订单详情（凭 orderNo 直接查询） */
  @Public()
  @Get('order/:orderNo')
  detail(@Param('orderNo') orderNo: string) {
    return this.svc.detail(orderNo);
  }
}
