import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { CursorSellFulfilService } from './cursor-sell-fulfil.service';

class OrderAccessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  orderNo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contact?: string;
}

class LoginApproveDto extends OrderAccessDto {
  @IsString()
  @IsNotEmpty({ message: '请粘贴登录链接' })
  @MaxLength(4000)
  loginUrl!: string;
}

/**
 * 前台订单页用的 Team 成交操作（公开接口）。
 * 鉴权沿用订单查询规则：订单号 + （下单时填过联系方式则必须匹配）。
 */
@ApiTags('cursor-sell')
@Controller('cursor-sell')
export class CursorSellController {
  constructor(
    private prisma: PrismaService,
    private fulfil: CursorSellFulfilService,
    private audit: AuditService,
  ) {}

  /** 校验：订单可访问 + 该成交属于该订单 */
  private async assertAccess(saleLocalId: number, orderNo: string, contact?: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo: orderNo.trim() },
      select: { orderNo: true, contact: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.contact && (contact?.trim() || '') !== order.contact) {
      throw new NotFoundException('订单不存在');
    }
    const sale = await this.prisma.cursorSellSale.findUnique({ where: { id: saleLocalId } });
    if (!sale) throw new NotFoundException('成交记录不存在');
    let belongs = sale.orderNo === order.orderNo;
    if (!belongs && sale.cardKeyId) {
      const ck = await this.prisma.cardKey.findUnique({
        where: { id: sale.cardKeyId },
        select: { orderNo: true },
      });
      belongs = ck?.orderNo === order.orderNo;
    }
    if (!belongs) throw new NotFoundException('成交记录不存在');
    return sale;
  }

  /** 用户提交 Cursor 客户端的 loginDeepControl 链接，完成授权登录 */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sales/:id/login-approve')
  async loginApprove(@Param('id') id: string, @Body() body: LoginApproveDto, @Req() req: Request) {
    const sale = await this.assertAccess(Number(id), body.orderNo, body.contact);
    const r = await this.fulfil.loginApprove(sale.id, body.loginUrl);
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_LOGIN_APPROVE, {
      target: `sale:${sale.id}`,
      detail: { approved: r.approved, orderNo: body.orderNo, by: 'customer' },
    });
    return r;
  }

  /** 只读额度（邮箱 / 会员 / 用量） */
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Get('sales/:id/usage')
  async usage(
    @Param('id') id: string,
    @Query('orderNo') orderNo: string,
    @Query('contact') contact?: string,
  ) {
    const sale = await this.assertAccess(Number(id), orderNo || '', contact);
    return this.fulfil.usage(sale.id);
  }

  /** 授权登录教程正文 */
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Get('sales/:id/login-tutorial')
  async loginTutorial(
    @Param('id') id: string,
    @Query('orderNo') orderNo: string,
    @Query('contact') contact?: string,
  ) {
    const sale = await this.assertAccess(Number(id), orderNo || '', contact);
    return this.fulfil.loginTutorial(sale.id);
  }

  /** 重取凭据 / 刷新开通状态 */
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('sales/:id/refresh')
  async refresh(@Param('id') id: string, @Body() body: OrderAccessDto) {
    const sale = await this.assertAccess(Number(id), body.orderNo, body.contact);
    return this.fulfil.refreshSaleById(sale.id);
  }
}
