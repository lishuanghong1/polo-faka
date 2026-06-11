import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { RecycleService } from './recycle.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

class RecycleDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: '请填写账单号' })
  @MaxLength(128, { message: '账单号过长' })
  invoiceNumber!: string;
}

@ApiTags('recycle')
@Controller('recycle')
export class RecycleController {
  constructor(private svc: RecycleService) {}

  /**
   * 公开：按邮箱匹配仓库账号，匹配上即用账号邮箱给 Cursor 发退款邮件。
   * 限流：单 IP 每分钟最多 5 次，防刷。
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  async submit(@Body() body: RecycleDto) {
    return this.svc.submit(body.email, body.invoiceNumber);
  }

  /** 管理后台：回收申请列表 */
  @Roles('ADMIN')
  @ApiBearerAuth()
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
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    });
  }

  /** 管理后台：重新核验某条回收申请的订阅状态 */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post(':id/refresh')
  refresh(@Param('id') id: string) {
    return this.svc.refresh(Number(id));
  }

  /** 管理后台：删除一条回收申请记录 */
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(Number(id));
  }
}
