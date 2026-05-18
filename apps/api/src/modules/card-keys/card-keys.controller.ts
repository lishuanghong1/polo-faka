import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CardKeysService } from './card-keys.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('card-keys')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('card-keys')
export class CardKeysController {
  constructor(
    private svc: CardKeysService,
    private audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('productId') productId?: string,
    @Query('skuId') skuId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      productId: productId ? Number(productId) : undefined,
      skuId: skuId ? Number(skuId) : undefined,
      status,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    });
  }

  @Get('stats')
  stats() {
    return this.svc.stats();
  }

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Post('bulk-import')
  async bulk(
    @Body() body: { productId: number; skuId: number; content: string; remark?: string },
    @Req() req: Request,
  ) {
    const r = await this.svc.bulkImport(body.productId, body.skuId, body.content, body.remark);
    this.audit.fromReq(req, AuditActions.CARD_KEY_BULK_IMPORT, {
      target: `sku:${body.skuId}`,
      detail: { inserted: r.inserted, duplicated: r.duplicated },
    });
    return r;
  }

  @Post('bulk-remove')
  async bulkRemove(@Body() body: { ids: number[] }, @Req() req: Request) {
    const r = await this.svc.bulkRemove(body.ids);
    this.audit.fromReq(req, AuditActions.CARD_KEY_BULK_REMOVE, {
      detail: { ids: body.ids?.slice(0, 50), count: r.deleted },
    });
    return r;
  }

  @Post('purge')
  async purge(@Body() body: { skuId: number; status: string }, @Req() req: Request) {
    const r = await this.svc.purge(body.skuId, body.status);
    this.audit.fromReq(req, AuditActions.CARD_KEY_PURGE, {
      target: `sku:${body.skuId}`,
      detail: { status: body.status, count: r.deleted },
    });
    return r;
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.update(Number(id), body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const r = await this.svc.remove(Number(id));
    this.audit.fromReq(req, AuditActions.CARD_KEY_DELETE, { target: `card:${id}` });
    return r;
  }
}
