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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ForgeOrderStatus } from '@prisma/client';
import { ForgeRedeemService } from './forge-redeem.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { GenerateForgeCodesDto, UpdateForgeProductDto } from './dto';

@ApiTags('admin-forge')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/forge')
export class ForgeRedeemAdminController {
  constructor(private svc: ForgeRedeemService) {}

  // ── 商品同步 / 管理 ─────────────────────────────────
  @Post('products/sync')
  syncProducts() {
    return this.svc.syncProducts();
  }

  @Get('products')
  listProducts() {
    return this.svc.listProductsAdmin();
  }

  @Put('products/:typeKey')
  updateProduct(@Param('typeKey') typeKey: string, @Body() dto: UpdateForgeProductDto) {
    return this.svc.updateProduct(typeKey, dto);
  }

  // ── 兑换码 ─────────────────────────────────────────
  @Post('redeem-codes/generate')
  generateCodes(@Body() dto: GenerateForgeCodesDto) {
    return this.svc.generateCodes(dto);
  }

  @Get('redeem-codes')
  listCodes(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('batchTag') batchTag?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.svc.listCodes({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status,
      batchTag,
      keyword,
    });
  }

  @Get('redeem-codes/batches')
  batches() {
    return this.svc.batches();
  }

  @Get('redeem-codes/batch/:batchTag')
  getBatch(@Param('batchTag') batchTag: string) {
    return this.svc.getBatch(batchTag);
  }

  @Put('redeem-codes/:id/status')
  toggleStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.svc.toggleCodeStatus(id, body.status);
  }

  @Delete('redeem-codes/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.removeCode(id);
  }

  // ── 三方订单流水 ─────────────────────────────────────
  @Get('orders')
  listOrders(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('typeKey') typeKey?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.svc.listOrdersAdmin({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status: status ? (status as ForgeOrderStatus) : undefined,
      typeKey,
      keyword,
    });
  }

  @Get('orders/:orderNo')
  orderDetail(@Param('orderNo') orderNo: string) {
    return this.svc.detailAdmin(orderNo);
  }
}
