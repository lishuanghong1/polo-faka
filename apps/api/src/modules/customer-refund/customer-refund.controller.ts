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
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CustomerRefundService } from './customer-refund.service';

/** 前台：客户自助退款（无需登录，输入邮箱即可） */
@ApiTags('customer-refund')
@Controller('customer-refund')
export class CustomerRefundPublicController {
  constructor(private svc: CustomerRefundService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('apply')
  apply(@Body() body: { email: string }, @Req() req: Request) {
    return this.svc.apply(body?.email, req.ip);
  }

  /** 凭 token 直接退款（不校验白名单）。同步执行，退款链较慢，限流更严格。 */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('apply-token')
  applyByToken(@Body() body: { token: string }) {
    return this.svc.applyByToken(body?.token);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('status')
  status(@Query('email') email: string) {
    return this.svc.status(email);
  }
}

/** 后台：退款白名单维护 */
@ApiTags('admin-customer-refund')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/customer-refund')
export class CustomerRefundAdminController {
  constructor(private svc: CustomerRefundService) {}

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

  @Post()
  add(@Body() body: { email: string; cursorToken: string; note?: string }) {
    return this.svc.addOne(body?.email, body?.cursorToken, body?.note);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { email?: string; cursorToken?: string; note?: string },
  ) {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  @Post('bulk-import')
  bulkImport(@Body() body: { text: string; separator?: string }) {
    return this.svc.bulkImport(body?.text || '', body?.separator || '----');
  }

  @Post(':id/refund')
  refundNow(@Param('id', ParseIntPipe) id: number) {
    return this.svc.refundNow(id);
  }

  @Post(':id/refund-reset')
  resetRefund(@Param('id', ParseIntPipe) id: number) {
    return this.svc.resetRefund(id);
  }
}
