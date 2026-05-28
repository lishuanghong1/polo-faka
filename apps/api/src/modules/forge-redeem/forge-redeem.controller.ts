import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForgeOpenapiService } from '../forge-openapi/forge-openapi.service';
import { ForgeProductsService } from './forge-products.service';
import { ForgeRedeemCodesService } from './forge-redeem-codes.service';
import { ForgeOrdersService } from './forge-orders.service';
import {
  AlipayOrderDto,
  RedeemCheckDto,
  RedeemOrderDto,
} from './dto';

/**
 * 公开端点（无需登录）。
 * 前缀沿用 /forge-redeem 以保持向后兼容；新增的支付宝路径也挂在这下面。
 */
@ApiTags('forge-redeem')
@Controller('forge-redeem')
export class ForgeRedeemController {
  constructor(
    private products: ForgeProductsService,
    private codes: ForgeRedeemCodesService,
    private orders: ForgeOrdersService,
  ) {}

  // ── 商品 ─────────────────────────────────────────
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('products')
  listProducts() {
    return this.products.listPublic();
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('products/:typeKey')
  async getProduct(@Param('typeKey') typeKey: string) {
    const p = await this.products.getPublic(typeKey);
    if (!p) return null;
    return p;
  }

  // ── 兑换码 ───────────────────────────────────────
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('check')
  async check(@Body() body: RedeemCheckDto) {
    const info = await this.codes.info(body.code);
    const products = await this.products.listPublic();
    return { ...info, products };
  }

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('order')
  async orderByCode(
    @Body() body: RedeemOrderDto,
    @Req() req: Request,
    @CurrentUser('sub') userId?: number,
  ) {
    try {
      return await this.orders.createByRedeemCode({
        code: body.code,
        typeKey: body.typeKey,
        quantity: body.quantity,
        contact: body.contact,
        ip: req.ip,
        userId: userId ?? null,
      });
    } catch (e) {
      throw ForgeOpenapiService.toHttpException(e);
    }
  }

  // ── 支付宝路径下单 ────────────────────────────────
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('alipay-order')
  async orderByAlipay(
    @Body() body: AlipayOrderDto,
    @Req() req: Request,
    @CurrentUser('sub') userId?: number,
  ) {
    return this.orders.createForAlipay({
      typeKey: body.typeKey,
      quantity: body.quantity,
      contact: body.contact,
      ip: req.ip,
      userId: userId ?? null,
    });
  }

  // ── 订单查询 ────────────────────────────────────
  @Public()
  @Get('order/:orderNo')
  detail(
    @Param('orderNo') orderNo: string,
    @Query('contact') contact?: string,
  ) {
    return this.orders.query(orderNo, contact);
  }

  // ── 用户中心：我的三方订单（需登录） ──────────────
  @ApiBearerAuth()
  @Get('orders/mine')
  myOrders(
    @CurrentUser('sub') userId: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orders.listMine(userId, Number(page) || 1, Number(pageSize) || 20);
  }
}
