import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { PoolService } from './pool.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

@ApiTags('pool')
@Controller('pool')
export class PoolController {
  constructor(
    private svc: PoolService,
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * 绑定 Cursor Token 到订单。
   * 要求：必须登录 + 订单所有者本人；不允许游客订单走该接口。
   */
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('grants/:orderNo/bind-token')
  async bind(
    @Param('orderNo') orderNo: string,
    @Body() body: { token: string },
    @CurrentUser('sub') userId: number,
  ) {
    if (!body?.token || body.token.length < 8) throw new BadRequestException('token 无效');
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (!order.userId || order.userId !== userId) {
      throw new ForbiddenException('订单不属于当前用户');
    }
    return this.svc.bindUserToken(orderNo, body.token);
  }

  /**
   * 查询订单额度。要求登录且为订单所有者。
   */
  @ApiBearerAuth()
  @Get('grants/:orderNo')
  async query(
    @Param('orderNo') orderNo: string,
    @CurrentUser('sub') userId: number,
  ) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (!order.userId || order.userId !== userId) {
      throw new ForbiddenException('订单不属于当前用户');
    }
    return this.svc.queryQuota(orderNo);
  }

  /**
   * 从平台维护的号池里申请一个可用账号。
   * 已经申请过的订单会返回同一个账号；额度耗尽/过期后不再返回 Token。
   */
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('grants/:orderNo/claim-account')
  async claim(
    @Param('orderNo') orderNo: string,
    @CurrentUser('sub') userId: number,
  ) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (!order.userId || order.userId !== userId) {
      throw new ForbiddenException('订单不属于当前用户');
    }
    return this.svc.claimAccount(orderNo);
  }

  /** Token 一键激活（公开，限流以防滥用） */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('activate')
  activate(@Body() body: { token: string; captcha?: string }) {
    if (!body?.token || body.token.length < 8) throw new BadRequestException('token 无效');
    return this.svc.activateUserToken(body.token, body.captcha);
  }

  // ===== Admin =====
  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('accounts')
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.svc.listAccounts(Number(page) || 1, Number(pageSize) || 30);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('accounts/:id/reveal')
  async reveal(
    @Param('id') id: string,
    @CurrentUser() user: { sub: number; username: string },
    @Req() req: Request,
  ) {
    const r = await this.svc.revealToken(Number(id), { id: user.sub, username: user.username });
    this.audit.fromReq(req, AuditActions.POOL_TOKEN_REVEAL, {
      target: `pool:${id}`,
      detail: { label: r.label },
    });
    return r;
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('accounts')
  async create(@Body() body: any, @Req() req: Request) {
    const r = await this.svc.createAccount(body);
    this.audit.fromReq(req, AuditActions.POOL_ACCOUNT_CREATE, {
      target: `pool:${r.id}`,
      detail: { label: r.label, type: r.type },
    });
    return r;
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Put('accounts/:id')
  async update(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const r = await this.svc.updateAccount(Number(id), body);
    this.audit.fromReq(req, AuditActions.POOL_ACCOUNT_UPDATE, {
      target: `pool:${id}`,
      detail: { tokenChanged: !!body?.token },
    });
    return r;
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Delete('accounts/:id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const r = await this.svc.removeAccount(Number(id));
    this.audit.fromReq(req, AuditActions.POOL_ACCOUNT_DELETE, { target: `pool:${id}` });
    return r;
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('accounts/refresh-all')
  refresh() {
    return this.svc.refreshAllAccounts();
  }
}
