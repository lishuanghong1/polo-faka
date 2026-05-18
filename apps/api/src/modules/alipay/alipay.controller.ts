import {
  BadRequestException,
  Body,
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
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('alipay')
@Controller('pay/alipay')
export class AlipayController {
  private readonly logger = new Logger(AlipayController.name);

  constructor(
    private readonly alipay: AlipayService,
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
  ) {}

  /** 检测前台是否要展示「支付宝」选项 */
  @Public()
  @Get('enabled')
  async enabled() {
    return { enabled: await this.alipay.isEnabled() };
  }

  /** 创建支付链接（前端跳转到该 URL 进入支付宝收银台） */
  @Public()
  @Get('create/:orderNo')
  async create(
    @Param('orderNo') orderNo: string,
    @Query('channel') channel: 'PC' | 'WAP' = 'PC',
    @Query('return') returnUrl?: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BadRequestException('订单不存在');
    if (order.status !== 'PENDING') {
      throw new BadRequestException('订单状态不允许支付');
    }
    const url = await this.alipay.createPayUrl({
      orderNo: order.orderNo,
      amount: Number(order.payAmount),
      subject: order.productTitle,
      channel: channel === 'WAP' ? 'WAP' : 'PC',
      returnUrl,
    });
    return { orderNo, payUrl: url };
  }

  /**
   * 异步通知（支付宝服务器 POST，application/x-www-form-urlencoded）
   * 必须验签 + 金额校验，幂等。
   * 必须返回纯文本 "success" 或 "fail"。
   */
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

      // 仅在交易成功状态下处理
      if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
        return res.status(200).send('success');
      }

      const order = await this.prisma.order.findUnique({ where: { orderNo } });
      if (!order) {
        this.logger.warn(`alipay notify: order ${orderNo} not found`);
        return res.status(200).send('fail');
      }

      // 金额校验：必须等于订单 payAmount
      if (Math.abs(totalAmount - Number(order.payAmount)) > 0.01) {
        this.logger.error(
          `alipay notify amount mismatch: order=${order.payAmount} notify=${totalAmount}`,
        );
        return res.status(200).send('fail');
      }

      // 已发货/已退款/已取消：直接返回 success（幂等）
      if (['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(order.status)) {
        return res.status(200).send('success');
      }

      // 记录 trade_no
      await this.prisma.order.update({
        where: { orderNo },
        data: { thirdTradeNo: tradeNo },
      });

      // 触发标记已支付 + 自动出库
      await this.orders.markPaidAndDeliver(orderNo);
      return res.status(200).send('success');
    } catch (e) {
      this.logger.error(`alipay notify exception: ${(e as Error).message}`);
      return res.status(200).send('fail');
    }
  }

  /**
   * 同步跳转回（用户支付完成后浏览器 GET 回到这里）
   * 不能完全信任，仅用于跳转 + 兜底快查一次状态。真发货以 notify 为准。
   */
  @Public()
  @Get('return')
  async ret(@Req() req: Request, @Res() res: Response) {
    const query = req.query as Record<string, any>;
    try {
      const ok = await this.alipay.verifyNotify(query);
      const orderNo = query.out_trade_no;
      if (ok && orderNo) {
        // 兜底：try 标记一次（如果通知还没到）
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

  /** 设置变更后强制重载 SDK */
  @Post('reload')
  async reload() {
    this.alipay.invalidate();
    return { ok: true };
  }
}
