import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RechargeService } from './recharge.service';
import { ListMyRechargeDto } from './dto';

@ApiTags('recharge')
@ApiBearerAuth()
@Controller('recharge')
export class RechargeController {
  constructor(private readonly svc: RechargeService) {}

  /** 创建充值订单（必须登录） */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create() {
    throw new ForbiddenException('用户自助充值已关闭，请联系客服充值');
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
