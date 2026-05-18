import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RedeemService } from './redeem.service';
import { AuditService } from '../audit/audit.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

function getIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || undefined;
}

@ApiTags('redeem')
@Controller()
export class RedeemController {
  constructor(
    private svc: RedeemService,
    private audit: AuditService,
  ) {}

  // ─────────────────────────── Admin ───────────────────────────

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('admin/redeem-codes/generate')
  async generate(
    @Body()
    body: {
      productId: number;
      skuId: number;
      count: number;
      qtyPerUse?: number;
      maxUses?: number;
      expireAt?: string;
      note?: string;
      prefix?: string;
    },
    @Req() req: Request,
  ) {
    const r = await this.svc.generate(body);
    this.audit.fromReq(req, 'REDEEM_CODE_GENERATE', {
      target: `batch:${r.batchTag}`,
      detail: { count: r.count, skuId: body.skuId, qtyPerUse: body.qtyPerUse, maxUses: body.maxUses },
    });
    return r;
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('admin/redeem-codes')
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('batchTag') batchTag?: string,
    @Query('skuId') skuId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.svc.list({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
      status,
      batchTag,
      skuId: skuId ? Number(skuId) : undefined,
      keyword,
    });
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('admin/redeem-codes/overview')
  overview() {
    return this.svc.overview();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('admin/redeem-codes/batches')
  batches() {
    return this.svc.batches();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('admin/redeem-codes/batch/:tag')
  getBatch(@Param('tag') tag: string) {
    return this.svc.getBatch(tag);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Put('admin/redeem-codes/:id/status')
  async setStatus(
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
    @Req() req: Request,
  ) {
    const r = await this.svc.toggleStatus(Number(id), body.status);
    this.audit.fromReq(req, 'REDEEM_CODE_STATUS', {
      target: `redeem:${id}`,
      detail: { status: body.status },
    });
    return r;
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('admin/redeem-codes/batch-status')
  async batchStatus(
    @Body() body: { ids: number[]; status: 'ACTIVE' | 'DISABLED' },
    @Req() req: Request,
  ) {
    const r = await this.svc.batchToggleStatus(body.ids, body.status);
    this.audit.fromReq(req, 'REDEEM_CODE_STATUS', {
      detail: { count: body.ids?.length ?? 0, status: body.status },
    });
    return r;
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Delete('admin/redeem-codes/:id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const r = await this.svc.remove(Number(id));
    this.audit.fromReq(req, 'REDEEM_CODE_DELETE', { target: `redeem:${id}` });
    return r;
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('admin/redeem-codes/batch-remove')
  async batchRemove(@Body() body: { ids: number[] }, @Req() req: Request) {
    const r = await this.svc.batchRemove(body.ids);
    this.audit.fromReq(req, 'REDEEM_CODE_DELETE', {
      detail: { count: r.deleted },
    });
    return r;
  }

  // ─────────────────────────── 客户 ───────────────────────────

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('redeem/:code')
  info(@Param('code') code: string) {
    return this.svc.info(code);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('redeem')
  async redeem(
    @Body() body: { code: string; contact?: string },
    @Req() req: Request,
    @CurrentUser() user?: { sub?: number },
  ) {
    return this.svc.redeem({
      code: body.code,
      contact: body.contact,
      userId: user?.sub ?? null,
      ip: getIp(req),
      userAgent: req.headers['user-agent']?.toString(),
    });
  }
}
