import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService } from './users.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private svc: UsersService,
    private audit: AuditService,
  ) {}

  @Get('my/balance-logs')
  myBalance(
    @CurrentUser('sub') userId: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.myBalanceLogs(userId, Number(page) || 1, Number(pageSize) || 30);
  }

  @Roles('ADMIN')
  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.svc.list(Number(page) || 1, Number(pageSize) || 20, keyword);
  }

  @Roles('ADMIN')
  @Get(':id/detail')
  detail(@Param('id') id: string) {
    return this.svc.detail(Number(id));
  }

  @Roles('ADMIN')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser('sub') actorId: number,
    @Req() req: Request,
  ) {
    const r = await this.svc.update(Number(id), body, actorId);
    this.audit.fromReq(req, AuditActions.USER_UPDATE, {
      target: `user:${id}`,
      detail: { keys: Object.keys(body || {}) },
    });
    return r;
  }

  @Roles('ADMIN')
  @Put(':id/adjust-balance')
  async adjust(
    @Param('id') id: string,
    @Body() body: { amount: number; note?: string },
    @Req() req: Request,
  ) {
    const r = await this.svc.adjustBalance(Number(id), Number(body.amount), body.note);
    this.audit.fromReq(req, AuditActions.BALANCE_ADJUST, {
      target: `user:${id}`,
      detail: { amount: Number(body.amount), note: body.note, newBalance: r },
    });
    return r;
  }
}
