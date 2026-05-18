import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private svc: ProductsService) {}

  @Public()
  @Get()
  list(
    @Query('categoryId') categoryId?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      categoryId: categoryId ? Number(categoryId) : undefined,
      keyword,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    });
  }

  @Public()
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(Number(id));
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() body: any) {
    return this.svc.create(body);
  }

  @Roles('ADMIN')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.update(Number(id), body);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(Number(id));
  }

  @Roles('ADMIN')
  @Put(':id/status')
  setStatus(@Param('id') id: string, @Body() body: { status: 'ON_SALE' | 'OFF_SHELF' | 'DRAFT' }) {
    return this.svc.setStatus(Number(id), body.status);
  }
}
