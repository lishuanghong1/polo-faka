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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CursorQuotaService } from './cursor-quota.service';
import {
  CreateCursorQuotaDto,
  UpdateCursorQuotaDto,
  BulkImportCursorQuotaDto,
  QueryCursorQuotaDto,
} from './dto';

@ApiTags('admin-cursor-quota')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/cursor-quota')
export class CursorQuotaController {
  constructor(private readonly svc: CursorQuotaService) {}

  @Get('stats')
  stats() {
    return this.svc.stats();
  }

  @Get()
  list(@Query() q: QueryCursorQuotaDto) {
    return this.svc.list(q);
  }

  @Post()
  create(@Body() dto: CreateCursorQuotaDto) {
    return this.svc.create(dto);
  }

  @Post('bulk-import')
  bulkImport(@Body() dto: BulkImportCursorQuotaDto) {
    return this.svc.bulkImport(dto);
  }

  @Post('refresh-all')
  refreshAll() {
    return this.svc.refreshAll();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCursorQuotaDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  @Post(':id/refresh')
  refresh(@Param('id', ParseIntPipe) id: number) {
    return this.svc.refresh(id);
  }

  @Get(':id/report')
  report(@Param('id', ParseIntPipe) id: number) {
    return this.svc.report(id);
  }

  @Get(':id/snapshots')
  snapshots(@Param('id', ParseIntPipe) id: number) {
    return this.svc.snapshots(id);
  }
}
