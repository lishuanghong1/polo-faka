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
import { Roles } from '../../common/decorators/roles.decorator';
import { CursorSubService } from './cursor-sub.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import {
  BulkImportCursorSubDto,
  CreateCursorSubDto,
  MigrateCursorSubItemDto,
  UpdateCursorSubDto,
} from './dto';

@ApiTags('admin-cursor-sub')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/cursor-sub')
export class CursorSubController {
  constructor(
    private svc: CursorSubService,
    private audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      status,
      keyword,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateCursorSubDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCursorSubDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  @Post('bulk-import')
  bulkImport(@Body() dto: BulkImportCursorSubDto) {
    return this.svc.bulkImport(dto);
  }

  @Get(':id/export')
  export(@Param('id', ParseIntPipe) id: number, @Query('separator') separator?: string) {
    return this.svc.export(id, separator || '----');
  }

  @Post(':id/mark-paid')
  markPaid(@Param('id', ParseIntPipe) id: number) {
    return this.svc.markPaid(id);
  }

  @Post(':id/sync-subscription')
  syncSubscription(@Param('id', ParseIntPipe) id: number) {
    return this.svc.syncSubscription(id);
  }

  /** 批量同步订阅状态 */
  @Post('sync-subscriptions')
  syncMany(@Body() body: { ids: number[] }) {
    return this.svc.syncMany(body?.ids || []);
  }

  @Get(':id/usage')
  usage(@Param('id', ParseIntPipe) id: number) {
    return this.svc.fetchUsage(id);
  }

  @Post(':id/push-to-warehouse')
  async pushToWarehouse(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const r = await this.svc.pushToWarehouse(id);
    this.audit.fromReq(req, AuditActions.CURSOR_SUB_PUSH, {
      target: `cursor-sub:${id}`,
      detail: { warehouseRef: r.warehouseRef },
    });
    return r;
  }

  /** 生成单个账号的订阅结账链接 */
  @Post(':id/checkout-link')
  generateCheckoutLink(@Param('id', ParseIntPipe) id: number) {
    return this.svc.generateCheckoutLink(id);
  }

  /** 批量生成订阅结账链接 */
  @Post('checkout-links')
  generateCheckoutLinks(@Body() body: { ids: number[] }) {
    return this.svc.generateCheckoutLinks(body?.ids || []);
  }

  /** 从 cursor-jb 导出的已解密账号批量迁移导入 */
  @Post('migrate')
  async migrate(@Body() body: { items: MigrateCursorSubItemDto[] }, @Req() req: Request) {
    const r = await this.svc.migrateImport(body?.items || []);
    this.audit.fromReq(req, AuditActions.CURSOR_SUB_MIGRATE, {
      detail: { total: r.total, created: r.created, skipped: r.skipped },
    });
    return r;
  }
}
