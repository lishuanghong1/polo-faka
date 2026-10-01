import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { UsageCheckDto } from './dto';
import { UsageCheckService } from './usage-check.service';

@ApiTags('usage-check')
@Public()
@Controller('usage-check')
export class UsageCheckController {
  constructor(private readonly service: UsageCheckService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async query(@Body() dto: UsageCheckDto) {
    // Reports already have a success field; wrap explicitly for the global API contract.
    return { success: true, data: await this.service.query(dto.token) };
  }
}
