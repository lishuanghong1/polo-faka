import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { RecycleService } from './recycle.service';
import { Public } from '../../common/decorators/public.decorator';

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
   * 公开：按邮箱匹配仓库账号，匹配上即向 Cursor 提交退款（回收）请求。
   * 限流：单 IP 每分钟最多 5 次，防刷。
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  async submit(@Body() body: RecycleDto) {
    return this.svc.submit(body.email, body.invoiceNumber);
  }
}
