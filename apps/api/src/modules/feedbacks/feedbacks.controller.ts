import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { FeedbacksService } from './feedbacks.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

class SubmitFeedbackDto {
  @IsOptional()
  @IsIn(['BUG', 'SUGGESTION', 'OTHER'])
  type?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contact?: string;
}

class UpdateFeedbackDto {
  @IsOptional()
  @IsIn(['NEW', 'PROCESSING', 'RESOLVED', 'IGNORED'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reply?: string;
}

@ApiTags('feedbacks')
@Controller('feedbacks')
export class FeedbacksController {
  constructor(private svc: FeedbacksService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('submit')
  submit(@Body() body: SubmitFeedbackDto) {
    return this.svc.submit(body);
  }

  @Roles('ADMIN')
  @Get()
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.svc.list(Number(page) || 1, Number(pageSize) || 30);
  }

  @Roles('ADMIN')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateFeedbackDto) {
    return this.svc.update(Number(id), body);
  }
}
