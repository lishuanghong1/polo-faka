import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('audit')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/audit')
export class AuditController {
  constructor(private svc: AuditService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('action') action?: string,
    @Query('actor') actor?: string,
    @Query('target') target?: string,
    @Query('actorId') actorId?: string,
    @Query('since') since?: string,
  ) {
    return this.svc.list({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
      action,
      actor,
      target,
      actorId: actorId ? Number(actorId) : undefined,
      since,
    });
  }

  @Get('actions')
  actions() {
    return this.svc.distinctActions();
  }
}
