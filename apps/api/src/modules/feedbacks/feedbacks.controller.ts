import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FeedbacksService } from './feedbacks.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('feedbacks')
@Controller('feedbacks')
export class FeedbacksController {
  constructor(private svc: FeedbacksService) {}

  @Public()
  @Post('submit')
  submit(@Body() body: { type?: string; content: string; contact?: string }) {
    return this.svc.submit(body);
  }

  @Roles('ADMIN')
  @Get()
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.svc.list(Number(page) || 1, Number(pageSize) || 30);
  }

  @Roles('ADMIN')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.update(Number(id), body);
  }
}
