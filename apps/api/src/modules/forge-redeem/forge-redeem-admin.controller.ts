import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ForgeOrderStatus, ForgePaymentMethod } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ForgeProductsService } from './forge-products.service';
import { ForgeRedeemCodesService } from './forge-redeem-codes.service';
import { ForgeOrdersService } from './forge-orders.service';
import { GenerateForgeCodesDto, UpdateForgeProductDto } from './dto';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';

@ApiTags('admin-forge')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/forge')
export class ForgeRedeemAdminController {
  constructor(
    private products: ForgeProductsService,
    private codes: ForgeRedeemCodesService,
    private orders: ForgeOrdersService,
    private audit: AuditService,
  ) {}

  // ── 商品 ───────────────────────────────────────
  @Post('products/sync')
  syncProducts() {
    return this.products.syncProducts();
  }

  @Get('products')
  listProducts() {
    return this.products.listAdmin();
  }

  @Put('products/:typeKey')
  async updateProduct(@Param('typeKey') typeKey: string, @Body() dto: UpdateForgeProductDto) {
    const r = await this.products.update(typeKey, dto);
    this.products.invalidateCache();
    return r;
  }

  // ── 兑换码 ─────────────────────────────────────
  @Post('redeem-codes/generate')
  generateCodes(@Body() dto: GenerateForgeCodesDto) {
    return this.codes.generate(dto);
  }

  @Get('redeem-codes')
  listCodes(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('batchTag') batchTag?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.codes.list({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status,
      batchTag,
      keyword,
    });
  }

  @Get('redeem-codes/batches')
  batches() {
    return this.codes.batches();
  }

  @Get('redeem-codes/batch/:batchTag')
  getBatch(@Param('batchTag') batchTag: string) {
    return this.codes.getBatch(batchTag);
  }

  @Put('redeem-codes/:id/status')
  toggleStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.codes.toggleStatus(id, body.status);
  }

  @Delete('redeem-codes/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.codes.remove(id);
  }

  // ── 三方订单 ───────────────────────────────────
  @Get('orders')
  listOrders(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('typeKey') typeKey?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.orders.listAdmin({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status: status ? (status as ForgeOrderStatus) : undefined,
      paymentMethod: paymentMethod ? (paymentMethod as ForgePaymentMethod) : undefined,
      typeKey,
      keyword,
    });
  }

  @Get('orders/:orderNo')
  orderDetail(@Param('orderNo') orderNo: string) {
    return this.orders.detail(orderNo);
  }

  @Post('orders/:orderNo/retry')
  retryFulfill(@Param('orderNo') orderNo: string) {
    return this.orders.adminRetryFulfill(orderNo);
  }

  @Delete('orders/:orderNo')
  async deleteOrder(@Param('orderNo') orderNo: string, @Req() req: Request) {
    const r = await this.orders.adminDelete(orderNo);
    this.audit.fromReq(req, AuditActions.FORGE_ORDER_DELETE, {
      target: `forge-order:${orderNo}`,
    });
    return r;
  }
}
