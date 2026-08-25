import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AccountVaultService } from './account-vault.service';
import {
  BulkActionVaultDto,
  BulkImportVaultDto,
  CheckBatchVaultDto,
  CreateVaultAccountDto,
  CreateVaultGroupDto,
  ExportVaultDto,
  QueryVaultDto,
  QueryVaultEventsDto,
  UpdateVaultAccountDto,
  UpdateVaultGroupDto,
} from './dto';

@ApiTags('admin-account-vault')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/account-vault')
export class AccountVaultController {
  constructor(private readonly svc: AccountVaultService) {}

  @Get('stats')
  stats() {
    return this.svc.stats();
  }

  @Get('batches')
  batches() {
    return this.svc.batches();
  }

  // ── 分组 ──

  @Get('groups')
  listGroups() {
    return this.svc.listGroups();
  }

  @Post('groups')
  createGroup(@Body() dto: CreateVaultGroupDto) {
    return this.svc.createGroup(dto);
  }

  @Patch('groups/:id')
  updateGroup(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVaultGroupDto) {
    return this.svc.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  removeGroup(@Param('id', ParseIntPipe) id: number) {
    return this.svc.removeGroup(id);
  }

  // ── 账号 ──

  @Get()
  list(@Query() q: QueryVaultDto) {
    return this.svc.list(q);
  }

  @Post()
  create(@Body() dto: CreateVaultAccountDto, @Req() req: Request) {
    return this.svc.create(dto, req);
  }

  @Post('bulk-import')
  bulkImport(@Body() dto: BulkImportVaultDto, @Req() req: Request) {
    return this.svc.bulkImport(dto, req);
  }

  @Post('bulk')
  bulkAction(@Body() dto: BulkActionVaultDto, @Req() req: Request) {
    return this.svc.bulkAction(dto, req);
  }

  @Post('export')
  exportAccounts(@Body() dto: ExportVaultDto, @Req() req: Request) {
    return this.svc.exportAccounts(dto, req);
  }

  @Post('check-batch')
  checkBatch(@Body() dto: CheckBatchVaultDto, @Req() req: Request) {
    return this.svc.checkBatch(dto, req);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Get(':id/reveal')
  reveal(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.svc.reveal(id, req);
  }

  @Get(':id/events')
  events(@Param('id', ParseIntPipe) id: number, @Query() q: QueryVaultEventsDto) {
    return this.svc.events(id, q.page, q.pageSize);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVaultAccountDto,
    @Req() req: Request,
  ) {
    return this.svc.update(id, dto, req);
  }

  @Delete(':id')
  softDelete(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.svc.softDelete(id, req);
  }

  @Post(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.svc.restore(id, req);
  }

  @Delete(':id/purge')
  purge(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.svc.purge(id, req);
  }

  @Post(':id/check')
  check(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.svc.checkOne(id, req);
  }

  @Get(':id/usage')
  usage(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.svc.usageReport(id, req);
  }
}
