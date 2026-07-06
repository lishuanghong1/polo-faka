import { Body, Controller, Get, HttpException, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForgeOpenapiService } from '../forge-openapi/forge-openapi.service';
import { ForgeQuotaPackagesService } from './forge-quota-packages.service';
import { ForgeQuotaOrdersService } from './forge-quota-orders.service';
import { QuotaPayOrderDto, QuotaRedeemOrderDto } from './dto';

/**
 * 额度包（中转 Key 额度包兑换码）公开端点。
 * 交付物是三方兑换码，买家拿码到 forge 官网 /redeem 核销。
 */
@ApiTags('forge-quota')
@Controller('forge-quota')
export class ForgeQuotaController {
  constructor(
    private packages: ForgeQuotaPackagesService,
    private orders: ForgeQuotaOrdersService,
  ) {}

  // ── 额度包 ───────────────────────────────────────
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('packages')
  listPackages() {
    return this.packages.listPublic();
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('packages/:packageKey')
  async getPackage(@Param('packageKey') packageKey: string) {
    const p = await this.packages.getPublic(packageKey);
    if (!p) return null;
    return p;
  }

  // ── 下单（本站余额型兑换码路径） ───────────────────
  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('order')
  async orderByCode(
    @Body() body: QuotaRedeemOrderDto,
    @Req() req: Request,
    @CurrentUser('sub') userId?: number,
  ) {
    try {
      return await this.orders.createByRedeemCode({
        code: body.code,
        packageKey: body.packageKey,
        quantity: body.quantity,
        contact: body.contact,
        ip: req.ip,
        userId: userId ?? null,
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw ForgeOpenapiService.toHttpException(e);
    }
  }

  // ── 支付宝路径下单 ────────────────────────────────
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('alipay-order')
  async orderByAlipay(
    @Body() body: QuotaPayOrderDto,
    @Req() req: Request,
    @CurrentUser('sub') userId?: number,
  ) {
    return this.orders.createForAlipay({
      packageKey: body.packageKey,
      quantity: body.quantity,
      contact: body.contact,
      ip: req.ip,
      userId: userId ?? null,
    });
  }

  // ── 余额支付下单（需登录） ────────────────────────
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('balance-order')
  async orderByBalance(
    @Body() body: QuotaPayOrderDto,
    @Req() req: Request,
    @CurrentUser('sub') userId: number,
  ) {
    try {
      return await this.orders.createByBalance({
        packageKey: body.packageKey,
        quantity: body.quantity,
        contact: body.contact,
        ip: req.ip,
        userId,
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw ForgeOpenapiService.toHttpException(e);
    }
  }

  // ── 积分支付下单（需登录） ────────────────────────
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('points-order')
  async orderByPoints(
    @Body() body: QuotaPayOrderDto,
    @Req() req: Request,
    @CurrentUser('sub') userId: number,
  ) {
    try {
      return await this.orders.createByPoints({
        packageKey: body.packageKey,
        quantity: body.quantity,
        contact: body.contact,
        ip: req.ip,
        userId,
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw ForgeOpenapiService.toHttpException(e);
    }
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

  /**
   * 刷新码核销状态（从三方拉最新）。
   * 与查单相同的 contact 防护；服务端有 10s 节流兜底。
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('order/:orderNo/refresh-codes')
  async refreshCodes(
    @Param('orderNo') orderNo: string,
    @Body() body: { contact?: string },
  ) {
    // 先走 query 校验 contact（订单受保护时防爆破）
    const q = await this.orders.query(orderNo, body?.contact);
    if ((q as any).requireContact) return q;
    return this.orders.refreshCodes(orderNo);
  }

  // ── 用户中心：我的额度包订单（需登录） ──────────────
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
