import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PointsService } from './points.service';

@ApiTags('points')
@ApiBearerAuth()
@Controller('points')
export class PointsController {
  constructor(private points: PointsService) {}

  @Get('me')
  me(@CurrentUser('sub') userId: number) {
    return this.points.myOverview(userId);
  }

  @Get('logs')
  logs(
    @CurrentUser('sub') userId: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.points.myLogs(userId, Number(page) || 1, Number(pageSize) || 30);
  }

  @Roles('ADMIN')
  @Get('admin/logs')
  adminLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('userId') userId?: string,
    @Query('type') type?: string,
  ) {
    return this.points.adminLogs(
      Number(page) || 1,
      Number(pageSize) || 50,
      userId ? Number(userId) : undefined,
      type,
    );
  }

  @Roles('ADMIN')
  @Post('admin/users/:id/adjust')
  adminAdjust(
    @Param('id') id: string,
    @Body() body: { amount: number; note?: string },
  ) {
    return this.points.adminAdjust(Number(id), Number(body.amount), body.note);
  }
}
