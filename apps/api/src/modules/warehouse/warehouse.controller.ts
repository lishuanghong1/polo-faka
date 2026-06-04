import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { WarehouseService } from './warehouse.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('warehouse')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('warehouse')
export class WarehouseController {
  constructor(
    private svc: WarehouseService,
    private audit: AuditService,
  ) {}

  /**
   * 外部系统（如 cursor-jb）批量推送账号入库。
   * body: { items: [{ sourceRef, content, email?, remark? }] }
   */
  @Post('bulk-import')
  async bulkImport(@Body() body: { items: any[] }, @Req() req: Request) {
    const r = await this.svc.bulkImport(body?.items || []);
    this.audit.fromReq(req, AuditActions.WAREHOUSE_BULK_IMPORT, {
      detail: {
        total: r.total,
        created: r.created,
        updated: r.updated,
        skipped: r.skipped,
      },
    });
    return r;
  }

  /** 反查：按 sourceRef 列表返回每条状态（供外部系统同步用） */
  @Post('status-by-refs')
  statusByRefs(@Body() body: { refs: string[] }) {
    return this.svc.statusBySourceRefs(body?.refs || []);
  }

  /** 外部系统下架：标 UNLISTED 并下架可售卡密 */
  @Post('unlist-by-ref')
  async unlistByRef(@Body() body: { sourceRef: string }, @Req() req: Request) {
    const r = await this.svc.unlistByRef(body?.sourceRef);
    this.audit.fromReq(req, AuditActions.WAREHOUSE_UNASSIGN, {
      target: `ref:${body?.sourceRef}`,
      detail: { action: 'unlist', ...r },
    });
    return r;
  }

  /** 外部系统恢复：UNLISTED -> PENDING */
  @Post('relist-by-ref')
  async relistByRef(@Body() body: { sourceRef: string }) {
    return this.svc.relistByRef(body?.sourceRef);
  }

  /** 外部系统删除：只删仓库记录，保留 CardKey/订单 */
  @Post('delete-by-ref')
  async deleteByRef(@Body() body: { sourceRef: string }, @Req() req: Request) {
    const r = await this.svc.deleteByRef(body?.sourceRef);
    this.audit.fromReq(req, AuditActions.WAREHOUSE_DELETE, {
      target: `ref:${body?.sourceRef}`,
      detail: { keptCardKey: (r as any)?.keptCardKey ?? null },
    });
    return r;
  }

  /** 列表 */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('sourceRef') sourceRef?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      status,
      sourceRef,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    });
  }

  /** 分配到商品 */
  @Post(':id/assign')
  async assign(
    @Param('id') id: string,
    @Body() body: { productId: number; skuId: number },
    @Req() req: Request,
  ) {
    const r = await this.svc.assign(Number(id), Number(body.productId), Number(body.skuId));
    this.audit.fromReq(req, AuditActions.WAREHOUSE_ASSIGN, {
      target: `warehouse:${id}`,
      detail: { productId: body.productId, skuId: body.skuId },
    });
    return r;
  }

  /** 撤回分配 */
  @Post(':id/unassign')
  async unassign(@Param('id') id: string, @Req() req: Request) {
    const r = await this.svc.unassign(Number(id));
    this.audit.fromReq(req, AuditActions.WAREHOUSE_UNASSIGN, {
      target: `warehouse:${id}`,
    });
    return r;
  }

  /** 删除 */
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const r = await this.svc.remove(Number(id));
    this.audit.fromReq(req, AuditActions.WAREHOUSE_DELETE, {
      target: `warehouse:${id}`,
    });
    return r;
  }
}
