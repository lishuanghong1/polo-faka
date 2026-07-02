import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RechargeService } from './recharge.service';
import { CreateRechargeDto, ListMyRechargeDto } from './dto';

function getIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || undefined;
}

@ApiTags('recharge')
@ApiBearerAuth()
@Controller('recharge')
export class RechargeController {
  constructor(private readonly svc: RechargeService) {}

  /** 创建充值订单（必须登录） */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  async create(
    @Body() dto: CreateRechargeDto,
    @Req() req: Request,
    @CurrentUser('sub') userId: number,
  ) {
    return this.svc.create(userId, dto.amount, getIp(req));
  }

  /** 查询单笔充值订单（仅自己） */
  @Get(':orderNo')
  detail(@Param('orderNo') orderNo: string, @CurrentUser('sub') userId: number) {
    return this.svc.detail(orderNo, userId);
  }

  /** 我的充值记录 */
  @Get()
  listMine(@Query() q: ListMyRechargeDto, @CurrentUser('sub') userId: number) {
    return this.svc.listMine(userId, q.page || 1, q.pageSize || 20);
  }
}
