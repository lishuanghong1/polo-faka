import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminService } from './admin.service';
import { OrdersService } from '../orders/orders.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private svc: AdminService,
    private orders: OrdersService,
    private audit: AuditService,
  ) {}

  @Get('dashboard')
  dash() {
    return this.svc.dashboard();
  }

  @Get('orders/recent')
  recent(@Query('limit') limit?: string) {
    return this.svc.recentOrders(Number(limit) || 20);
  }

  @Get('orders')
  ordersList(@Query() query: any) {
    return this.svc.listOrders(query);
  }

  @Get('orders/:orderNo')
  orderDetail(@Param('orderNo') orderNo: string) {
    return this.orders.detail(orderNo);
  }

  @Post('orders/:orderNo/mark-paid')
  async markPaid(@Param('orderNo') orderNo: string, @Req() req: Request) {
    const r = await this.orders.adminMarkPaid(orderNo);
    this.audit.fromReq(req, AuditActions.ORDER_MARK_PAID, { target: `order:${orderNo}` });
    return r;
  }

  @Post('orders/:orderNo/redeliver')
  async redeliver(@Param('orderNo') orderNo: string, @Req() req: Request) {
    const r = await this.orders.adminRedeliver(orderNo);
    this.audit.fromReq(req, AuditActions.ORDER_REDELIVER, { target: `order:${orderNo}` });
    return r;
  }

  @Post('orders/:orderNo/manual-deliver')
  async manualDeliver(
    @Param('orderNo') orderNo: string,
    @Body() body: { contents: string[] },
    @Req() req: Request,
  ) {
    const r = await this.orders.adminManualDeliver(orderNo, body.contents);
    this.audit.fromReq(req, AuditActions.ORDER_MANUAL_DELIVER, {
      target: `order:${orderNo}`,
      detail: { count: body.contents?.length ?? 0 },
    });
    return r;
  }

  @Post('orders/:orderNo/refund')
  async refund(
    @Param('orderNo') orderNo: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ) {
    const r = await this.orders.adminRefund(orderNo, body?.reason);
    this.audit.fromReq(req, AuditActions.ORDER_REFUND, {
      target: `order:${orderNo}`,
      detail: { reason: body?.reason },
    });
    return r;
  }

  @Post('orders/:orderNo/cancel')
  async cancel(@Param('orderNo') orderNo: string, @Req() req: Request) {
    const r = await this.orders.adminCancel(orderNo);
    this.audit.fromReq(req, AuditActions.ORDER_CANCEL, { target: `order:${orderNo}` });
    return r;
  }

  @Get('trend/revenue')
  revenueTrend(@Query('days') days?: string) {
    return this.svc.revenueTrend(Number(days) || 14);
  }

  @Get('stock/alerts')
  stockAlerts(@Query('threshold') threshold?: string) {
    return this.svc.stockAlerts(Number(threshold) || 5);
  }
}
