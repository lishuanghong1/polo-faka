import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ForgeOrderStatus, ForgePaymentMethod } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ForgeQuotaPackagesService } from './forge-quota-packages.service';
import { ForgeQuotaOrdersService } from './forge-quota-orders.service';
import { UpdateForgeQuotaPackageDto, VoidQuotaCodesDto } from './dto';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

@ApiTags('admin-forge-quota')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/forge/quota')
export class ForgeQuotaAdminController {
  constructor(
    private packages: ForgeQuotaPackagesService,
    private orders: ForgeQuotaOrdersService,
    private audit: AuditService,
  ) {}

  // ── 额度包 ───────────────────────────────────────
  @Post('packages/sync')
  syncPackages() {
    return this.packages.syncPackages();
  }

  @Get('packages')
  listPackages() {
    return this.packages.listAdmin();
  }

  @Put('packages/:packageKey')
  updatePackage(
    @Param('packageKey') packageKey: string,
    @Body() dto: UpdateForgeQuotaPackageDto,
  ) {
    return this.packages.update(packageKey, dto);
  }

  // ── 额度包订单 ───────────────────────────────────
  @Get('orders')
  listOrders(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('packageKey') packageKey?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.orders.listAdmin({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status: status ? (status as ForgeOrderStatus) : undefined,
      paymentMethod: paymentMethod ? (paymentMethod as ForgePaymentMethod) : undefined,
      packageKey,
      keyword,
    });
  }

  @Get('orders/:orderNo')
  orderDetail(@Param('orderNo') orderNo: string) {
    return this.orders.adminDetail(orderNo);
  }

  @Post('orders/:orderNo/retry')
  retryFulfill(@Param('orderNo') orderNo: string) {
    return this.orders.adminRetryFulfill(orderNo);
  }

  /** 从三方刷新该订单所有码的核销状态 */
  @Post('orders/:orderNo/refresh-codes')
  async refreshCodes(@Param('orderNo') orderNo: string) {
    await this.orders.refreshCodes(orderNo, true);
    return this.orders.adminDetail(orderNo);
  }

  @Delete('orders/:orderNo')
  async deleteOrder(@Param('orderNo') orderNo: string, @Req() req: Request) {
    const r = await this.orders.adminDelete(orderNo);
    this.audit.fromReq(req, AuditActions.FORGE_QUOTA_ORDER_DELETE, {
      target: `forge-quota-order:${orderNo}`,
    });
    return r;
  }

  // ── 兑换码售后工具 ────────────────────────────────
  /** 单码状态查询（买家说"码无效"时先查它是否已核销/已作废） */
  @Get('codes/:code')
  queryCode(@Param('code') code: string) {
    return this.orders.adminQueryCode(code);
  }

  /** 自助作废（未核销的码销毁 + 出库款自动退回代理余额） */
  @Post('codes/void')
  async voidCodes(@Body() dto: VoidQuotaCodesDto, @Req() req: Request) {
    const r = await this.orders.adminVoidCodes(dto.codes, dto.reason);
    this.audit.fromReq(req, AuditActions.FORGE_QUOTA_CODE_VOID, {
      target: `codes:${(dto.codes || []).length}`,
      detail: {
        requested: dto.codes,
        reason: dto.reason,
        voided: r.voided,
        skipped: r.skipped,
        refundTotal: r.refundTotal,
      },
    });
    return r;
  }
}
