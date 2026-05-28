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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AlipayService } from './alipay.service';
import { OrdersService } from '../orders/orders.service';
import { ForgeOrdersService } from '../forge-redeem/forge-orders.service';
import { RechargeService } from '../recharge/recharge.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

/** 仅允许本站内部相对路径作为 returnUrl，防止 open redirect。 */
function isSafeReturnUrl(u?: string): boolean {
  if (!u) return false;
  return /^\/(?!\/)/.test(u);
}

/**
 * 订单号规则：
 *   - 本地卡密订单：以 'P' 开头
 *   - 代下订单：以 'F' 开头
 *   - 余额充值订单：以 'R' 开头
 */
function isForgeOrder(orderNo: string) {
  return typeof orderNo === 'string' && orderNo.startsWith('F');
}

function isRechargeOrder(orderNo: string) {
  return typeof orderNo === 'string' && orderNo.startsWith('R');
}

/** 脱敏 buyer_logon_id（138****1234@qq.com → 138****1234@qq.com，邮箱/手机分别脱敏） */
function maskBuyerLogon(s?: string): string | undefined {
  if (!s) return undefined;
  const v = String(s);
  if (v.includes('@')) {
    const [name, domain] = v.split('@');
    if (name.length <= 3) return `***@${domain}`;
    return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
  }
  if (v.length >= 7) return `${v.slice(0, 3)}****${v.slice(-4)}`;
  return '****';
}

@ApiTags('alipay')
@Controller('pay/alipay')
export class AlipayController {
  private readonly logger = new Logger(AlipayController.name);

  constructor(
    private readonly alipay: AlipayService,
    private readonly orders: OrdersService,
    private readonly forgeOrders: ForgeOrdersService,
    private readonly recharge: RechargeService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
    let body: string | undefined;

    if (isRechargeOrder(orderNo)) {
      const r = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
      if (!r) throw new BadRequestException('订单不存在');
      if (r.status !== 'PENDING') {
        throw new BadRequestException('订单状态不允许支付');
      }
      if (r.expireAt.getTime() < Date.now()) {
        throw new BadRequestException('订单已过期');
      }
      payAmount = Number(r.amount);
      subject = `账户充值 ¥${payAmount.toFixed(2)}`;
      body = `账户充值 ${orderNo}`;
    } else if (isForgeOrder(orderNo)) {
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
      body = `${order.typeName} × ${order.quantity}`;
    } else {
      const order = await this.prisma.order.findUnique({ where: { orderNo } });
      if (!order) throw new BadRequestException('订单不存在');
      if (order.status !== 'PENDING') {
        throw new BadRequestException('订单状态不允许支付');
      }
      payAmount = Number(order.payAmount);
      subject = order.productTitle;
      body = `${order.productTitle} ${order.skuName} × ${order.quantity}`;
    }

    const url = await this.alipay.createPayUrl({
      orderNo,
      amount: payAmount,
      subject,
      body,
      channel: channel === 'WAP' ? 'WAP' : 'PC',
      returnUrl: isSafeReturnUrl(returnUrl) ? returnUrl : undefined,
    });
    return { orderNo, payUrl: url };
  }

  /**
   * 异步通知：必须验签 + seller_id 校验 + 金额校验 + 幂等。
   *
   * 响应语义（支付宝以此决定是否重推）：
   *   - 'success' = 已正确处理（或幂等命中），停止重推
   *   - 'fail'    = 未能处理（伪造 / 字段缺失 / 数据库异常），4-10-30...min 重推 8 次
   *
   * 关键点：发货走 setImmediate 异步，notify 在 < 100ms 内返回，
   *        避免上游慢导致 Express 超时 → 支付宝以为失败 → 重复推送 → 重复发货风险。
   */
  @Public()
  @Post('notify')
  async notify(@Req() req: Request, @Res() res: Response) {
    const postData = req.body as Record<string, any>;
    this.logger.log(
      `alipay notify: out_trade_no=${postData?.out_trade_no} trade_no=${postData?.trade_no} status=${postData?.trade_status} amount=${postData?.total_amount} buyer=${maskBuyerLogon(postData?.buyer_logon_id)}`,
    );

    try {
      const ok = await this.alipay.verifyNotify(postData);
      if (!ok) {
        // 验签或 seller_id/app_id 校验失败：高危事件，写审计
        await this.audit.record({
          action: AuditActions.ALIPAY_SIGN_FAIL,
          target: postData?.out_trade_no ? `order:${postData.out_trade_no}` : null,
          detail: {
            sellerId: postData?.seller_id,
            appId: postData?.app_id,
            tradeNo: postData?.trade_no,
          },
          ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim(),
        });
        // 验签失败不让支付宝重推（重推也不会通过）
        return res.status(200).send('success');
      }

      const orderNo: string = postData.out_trade_no;
      const tradeNo: string = postData.trade_no;
      const tradeStatus: string = postData.trade_status;
      const totalAmount = Number(postData.total_amount);
      const buyerLogonId: string | undefined = postData.buyer_logon_id;

      if (!orderNo) {
        this.logger.warn('alipay notify missing out_trade_no');
        return res.status(200).send('success'); // 数据有问题但不需要重推
      }

      // 退款 / 撤销 / 关闭 等状态变更，不在这里处理
      if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
        return res.status(200).send('success');
      }

      if (isRechargeOrder(orderNo)) {
        // 充值订单：金额校验 + 入账（增余额 + 写流水），均在 service 内同一事务
        try {
          await this.recharge.markPaidAndCredit(orderNo, tradeNo, totalAmount, buyerLogonId);
          return res.status(200).send('success');
        } catch (e) {
          const msg = (e as Error).message;
          if (msg.includes('金额不一致')) {
            await this.audit.record({
              action: AuditActions.BALANCE_RECHARGE_AMOUNT_MISMATCH,
              target: `recharge:${orderNo}`,
              detail: { tradeNo, paidAmount: totalAmount, msg },
            });
            // 高危：金额不对，不让重推
            return res.status(200).send('success');
          }
          if (msg.includes('订单不存在') || msg.includes('不允许')) {
            this.logger.warn(`recharge notify hard-fail: ${orderNo} ${msg}`);
            return res.status(200).send('success');
          }
          this.logger.error(`recharge notify retryable: ${orderNo} ${msg}`);
          return res.status(200).send('fail');
        }
      }

      if (isForgeOrder(orderNo)) {
        // 代下订单：仅做状态推进，发货异步
        try {
          const r = await this.forgeOrders.markPaid(orderNo, tradeNo, totalAmount, buyerLogonId);
          if (r === 'recorded') {
            this.forgeOrders.fulfillAsync(orderNo);
          }
          return res.status(200).send('success');
        } catch (e) {
          const msg = (e as Error).message;
          // 金额不一致 → 高危告警 + 不让重推（重推也不会通过）
          if (msg.includes('金额不一致')) {
            await this.audit.record({
              action: AuditActions.ALIPAY_AMOUNT_MISMATCH,
              target: `forge:${orderNo}`,
              detail: { tradeNo, paidAmount: totalAmount, msg },
            });
            return res.status(200).send('success');
          }
          // 订单不存在 / 类型不对 / 状态非法 → 不重推
          if (msg.includes('订单不存在') || msg.includes('不是支付宝订单') || msg.includes('不允许')) {
            this.logger.warn(`forge notify hard-fail: ${orderNo} ${msg}`);
            return res.status(200).send('success');
          }
          // 其他（DB 异常 / 网络等）→ 让支付宝重推
          this.logger.error(`forge notify retryable: ${orderNo} ${msg}`);
          return res.status(200).send('fail');
        }
      }

      // 本地卡密订单
      try {
        const r = await this.orders.markPaidOnly(orderNo, tradeNo, totalAmount, buyerLogonId);
        if (r === 'recorded') {
          this.orders.deliverAsync(orderNo);
        }
        return res.status(200).send('success');
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('金额不一致')) {
          await this.audit.record({
            action: AuditActions.ALIPAY_AMOUNT_MISMATCH,
            target: `order:${orderNo}`,
            detail: { tradeNo, paidAmount: totalAmount, msg },
          });
          return res.status(200).send('success');
        }
        if (msg.includes('订单不存在') || msg.includes('不允许')) {
          this.logger.warn(`order notify hard-fail: ${orderNo} ${msg}`);
          return res.status(200).send('success');
        }
        this.logger.error(`order notify retryable: ${orderNo} ${msg}`);
        return res.status(200).send('fail');
      }
    } catch (e) {
      this.logger.error(`alipay notify exception: ${(e as Error).message}`);
      // 真·未处理异常 → fail 让支付宝重推
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
      const buyerLogonId = query.buyer_logon_id as string | undefined;
      if (ok && orderNo) {
        if (isRechargeOrder(orderNo)) {
          try {
            await this.recharge.markPaidAndCredit(orderNo, tradeNo, totalAmount, buyerLogonId);
          } catch (e) {
            this.logger.warn(`return-ack recharge fallback: ${(e as Error).message}`);
          }
          return res.redirect(`/recharge/${encodeURIComponent(orderNo)}`);
        }
        if (isForgeOrder(orderNo)) {
          try {
            const r = await this.forgeOrders.markPaid(orderNo, tradeNo, totalAmount, buyerLogonId);
            if (r === 'recorded') this.forgeOrders.fulfillAsync(orderNo);
          } catch (e) {
            this.logger.warn(`return-ack forge fallback: ${(e as Error).message}`);
          }
          return res.redirect(`/forge-order/${encodeURIComponent(orderNo)}`);
        }

        try {
          const r = await this.orders.markPaidOnly(orderNo, tradeNo, totalAmount, buyerLogonId);
          if (r === 'recorded') this.orders.deliverAsync(orderNo);
        } catch (e) {
          this.logger.warn(`return-ack local fallback: ${(e as Error).message}`);
        }
        return res.redirect(`/order/${orderNo}`);
      }
    } catch {
      /* ignore */
    }
    return res.redirect('/');
  }

  /** 管理员手动刷新支付宝配置缓存 */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('reload')
  async reload() {
    this.alipay.invalidate();
    return { ok: true };
  }

  /**
   * 管理员主动查询支付宝订单状态（notify 丢失时排查 / 客服核单）。
   * 同时若发现订单已支付但本地是 PENDING，会自动推进 + 触发发货。
   */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('query/:orderNo')
  async adminQuery(@Param('orderNo') orderNo: string, @Req() req: Request) {
    const r = await this.alipay.tradeQuery(orderNo);
    await this.audit.fromReq(req, AuditActions.ALIPAY_MANUAL_QUERY, {
      target: isForgeOrder(orderNo) ? `forge:${orderNo}` : `order:${orderNo}`,
      detail: r,
    });

    // 自动补救：查到已支付 + 本地仍 PENDING → 推进
    if (r.tradeStatus === 'TRADE_SUCCESS' || r.tradeStatus === 'TRADE_FINISHED') {
      try {
        if (isForgeOrder(orderNo)) {
          const x = await this.forgeOrders.markPaid(
            orderNo,
            r.tradeNo!,
            r.totalAmount!,
            r.buyerLogonId,
          );
          if (x === 'recorded') this.forgeOrders.fulfillAsync(orderNo);
        } else {
          const x = await this.orders.markPaidOnly(
            orderNo,
            r.tradeNo!,
            r.totalAmount!,
            r.buyerLogonId,
          );
          if (x === 'recorded') this.orders.deliverAsync(orderNo);
        }
      } catch (e) {
        this.logger.warn(`adminQuery auto-fix failed: ${(e as Error).message}`);
      }
    }
    return r;
  }

  /**
   * 管理员发起原路退款。仅 PAID/DELIVERED 状态订单可退。
   * 全额退；部分退款留待业务需要时再加。
   */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('refund/:orderNo')
  async adminRefund(
    @Param('orderNo') orderNo: string,
    @Req() req: Request,
  ) {
    const reason = ((req.body?.reason as string) || '管理员退款').slice(0, 256);

    if (isForgeOrder(orderNo)) {
      const order = await this.prisma.forgeOrder.findUnique({ where: { orderNo } });
      if (!order) throw new BadRequestException('订单不存在');
      if (order.paymentMethod !== 'ALIPAY') {
        throw new BadRequestException('非支付宝订单');
      }
      if (!['PAID', 'DELIVERED', 'FAILED'].includes(order.status)) {
        throw new BadRequestException(`订单状态 ${order.status} 不可退款`);
      }
      const amount = Number(order.totalAmount);
      const r = await this.alipay.tradeRefund({
        orderNo,
        refundAmount: amount,
        refundReason: reason,
      });
      if (!r.ok) throw new BadRequestException(`退款失败：${r.reason}`);
      await this.prisma.forgeOrder.update({
        where: { orderNo },
        data: {
          status: 'REFUNDED',
          refundAmount: amount as any,
          refundedAt: new Date(),
          refundReason: reason,
        },
      });
      await this.audit.fromReq(req, AuditActions.ALIPAY_MANUAL_REFUND, {
        target: `forge:${orderNo}`,
        detail: { amount, reason, refundFee: r.refundFee },
      });
      return { ok: true, amount, refundFee: r.refundFee };
    }

    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BadRequestException('订单不存在');
    if (order.payMethod !== 'ALIPAY') throw new BadRequestException('非支付宝订单');
    if (!['PAID', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException(`订单状态 ${order.status} 不可退款`);
    }
    const amount = Number(order.payAmount);
    const r = await this.alipay.tradeRefund({
      orderNo,
      refundAmount: amount,
      refundReason: reason,
    });
    if (!r.ok) throw new BadRequestException(`退款失败：${r.reason}`);
    await this.prisma.order.update({
      where: { orderNo },
      data: {
        status: 'REFUNDED',
        refundAmount: amount as any,
        refundedAt: new Date(),
        refundReason: reason,
      },
    });
    await this.audit.fromReq(req, AuditActions.ALIPAY_MANUAL_REFUND, {
      target: `order:${orderNo}`,
      detail: { amount, reason, refundFee: r.refundFee },
    });
    return { ok: true, amount, refundFee: r.refundFee };
  }
}
