import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AlipayService } from './alipay.service';
import { OrdersService } from '../orders/orders.service';
import { ForgeOrdersService } from '../forge-redeem/forge-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * 订单号规则：
 *   - 本地卡密订单：以 'P' 开头（如 P20260519143012xxxxxxxxxxx）
 *   - Cursorforge 三方订单：以 'F' 开头（如 F20260519143012xxxxxxxxxxx）
 * 支付宝 create / notify 根据前缀分发。
 */
function isForgeOrder(orderNo: string) {
  return typeof orderNo === 'string' && orderNo.startsWith('F');
}

@ApiTags('alipay')
@Controller('pay/alipay')
export class AlipayController {
  private readonly logger = new Logger(AlipayController.name);

  constructor(
    private readonly alipay: AlipayService,
    private readonly orders: OrdersService,
    private readonly forgeOrders: ForgeOrdersService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('enabled')
  async enabled() {
    return { enabled: await this.alipay.isEnabled() };
  }

  /** 创建支付链接（兼容本地订单 / 三方订单） */
  @Public()
  @Get('create/:orderNo')
  async create(
    @Param('orderNo') orderNo: string,
    @Query('channel') channel: 'PC' | 'WAP' = 'PC',
    @Query('return') returnUrl?: string,
  ) {
    let payAmount: number;
    let subject: string;

    if (isForgeOrder(orderNo)) {
      const order = await this.prisma.forgeOrder.findUnique({ where: { orderNo } });
      if (!order) throw new BadRequestException('订单不存在');
      if (order.paymentMethod !== 'ALIPAY') {
        throw new BadRequestException('订单不是支付宝订单');
      }
      if (order.status !== 'PENDING') {
        throw new BadRequestException('订单状态不允许支付');
      }
      if (order.expireAt && order.expireAt.getTime() < Date.now()) {
        throw new BadRequestException('订单已过期');
      }
      payAmount = Number(order.totalAmount);
      subject = order.typeName;
    } else {
      const order = await this.prisma.order.findUnique({ where: { orderNo } });
      if (!order) throw new BadRequestException('订单不存在');
      if (order.status !== 'PENDING') {
        throw new BadRequestException('订单状态不允许支付');
      }
      payAmount = Number(order.payAmount);
      subject = order.productTitle;
    }

    const url = await this.alipay.createPayUrl({
      orderNo,
      amount: payAmount,
      subject,
      channel: channel === 'WAP' ? 'WAP' : 'PC',
      returnUrl,
    });
    return { orderNo, payUrl: url };
  }

  /** 异步通知（必须验签 + 金额校验 + 幂等；纯文本响应） */
  @Public()
  @Post('notify')
  async notify(@Req() req: Request, @Res() res: Response) {
    const postData = req.body as Record<string, any>;
    this.logger.log(`alipay notify: ${JSON.stringify(postData)}`);

    try {
      const ok = await this.alipay.verifyNotify(postData);
      if (!ok) {
        this.logger.warn('alipay notify sign check failed');
        return res.status(200).send('fail');
      }

      const orderNo: string = postData.out_trade_no;
      const tradeNo: string = postData.trade_no;
      const tradeStatus: string = postData.trade_status;
      const totalAmount = Number(postData.total_amount);

      if (!orderNo) return res.status(200).send('fail');

      if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
        return res.status(200).send('success');
      }

      if (isForgeOrder(orderNo)) {
        // ── Cursorforge 三方订单分支 ──
        try {
          await this.forgeOrders.markPaidAndFulfill(orderNo, tradeNo, totalAmount);
        } catch (e) {
          this.logger.error(`forge markPaidAndFulfill failed: ${(e as Error).message}`);
          // 注意：依然返回 success 给支付宝（已收到通知），失败由 admin 重试
        }
        return res.status(200).send('success');
      }

      // ── 本地卡密订单分支 ──
      const order = await this.prisma.order.findUnique({ where: { orderNo } });
      if (!order) {
        this.logger.warn(`alipay notify: order ${orderNo} not found`);
        return res.status(200).send('fail');
      }
      if (Math.abs(totalAmount - Number(order.payAmount)) > 0.01) {
        this.logger.error(
          `alipay notify amount mismatch: order=${order.payAmount} notify=${totalAmount}`,
        );
        return res.status(200).send('fail');
      }
      if (['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(order.status)) {
        return res.status(200).send('success');
      }
      await this.prisma.order.update({
        where: { orderNo },
        data: { thirdTradeNo: tradeNo },
      });
      await this.orders.markPaidAndDeliver(orderNo);
      return res.status(200).send('success');
    } catch (e) {
      this.logger.error(`alipay notify exception: ${(e as Error).message}`);
      return res.status(200).send('fail');
    }
  }

  /** 同步跳转回（仅用于浏览器重定向 + 兜底） */
  @Public()
  @Get('return')
  async ret(@Req() req: Request, @Res() res: Response) {
    const query = req.query as Record<string, any>;
    try {
      const ok = await this.alipay.verifyNotify(query);
      const orderNo = query.out_trade_no;
      const tradeNo = query.trade_no;
      const totalAmount = Number(query.total_amount);
      if (ok && orderNo) {
        if (isForgeOrder(orderNo)) {
          try {
            await this.forgeOrders.markPaidAndFulfill(orderNo, tradeNo, totalAmount);
          } catch (e) {
            this.logger.warn(`return-ack forge fulfill fallback: ${(e as Error).message}`);
          }
          return res.redirect(`/forge-order/${encodeURIComponent(orderNo)}`);
        }

        try {
          const order = await this.prisma.order.findUnique({ where: { orderNo } });
          if (order && order.status === 'PENDING') {
            await this.orders.markPaidAndDeliver(orderNo);
          }
        } catch (e) {
          this.logger.warn(`return-ack fallback failed: ${(e as Error).message}`);
        }
        return res.redirect(`/order/${orderNo}`);
      }
    } catch {
      /* ignore */
    }
    return res.redirect('/');
  }

  @Post('reload')
  async reload() {
    this.alipay.invalidate();
    return { ok: true };
  }
}
