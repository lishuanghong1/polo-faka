import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SiteSettingsService } from './site-settings.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('site-settings')
@Controller('site-settings')
export class SiteSettingsController {
  constructor(
    private svc: SiteSettingsService,
    private audit: AuditService,
  ) {}

  @Public()
  @Get('public')
  getPublic() {
    return this.svc.getPublic();
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('all')
  getAll() {
    return this.svc.getAll();
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  async setMany(
    @Body() body: Record<string, { value: string; isPublic?: boolean }>,
    @Req() req: Request,
  ) {
    const r = await this.svc.setMany(body);
    this.audit.fromReq(req, AuditActions.SETTINGS_UPDATE, {
      detail: { keys: Object.keys(body || {}) },
    });
    return r;
  }
}
