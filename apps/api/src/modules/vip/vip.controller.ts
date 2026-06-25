import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProductSource, VipTier } from '@prisma/client';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { VipService } from './vip.service';
import {
  ListUserVipDto,
  ManualSetVipDto,
  PreviewDiscountDto,
  SetUserDiscountDto,
  UpdateVipConfigDto,
  UpsertProductDiscountDto,
} from './dto';

@ApiTags('vip')
@ApiBearerAuth()
@Controller('vip')
export class VipController {
  constructor(private readonly svc: VipService) {}

  // ============= 公开接口 =============

  /** 公开：所有 VIP 等级配置（前端商品页用） */
  @Public()
  @Get('configs')
  configs() {
    return this.svc.listConfigs();
  }

  /** 公开：某商品的 3 档会员价 */
  @Public()
  @Get('product-discounts')
  productDiscounts(
    @Query('productSource') productSource: ProductSource,
    @Query('productKey') productKey: string,
  ) {
    return this.svc.listProductDiscounts(productSource, productKey);
  }

  /** 公开：给定金额预览（未登录返回原价；登录返回会员价） */
  @Public()
  @Post('preview')
  preview(@Body() dto: PreviewDiscountDto, @CurrentUser() user: JwtPayload | undefined) {
    return this.svc.applyDiscount(
      user?.sub,
      dto.productSource as ProductSource,
      dto.productKey,
      Number(dto.originalAmount),
    );
  }

  // ============= 用户接口 =============

  /** 我的 VIP 信息（个人中心展示） */
  @Get('me')
  me(@CurrentUser('sub') userId: number) {
    return this.svc.getMyVipInfo(userId);
  }

  // ============= 管理员接口 =============

  /** 管理员：列出 3 档等级配置（可编辑） */
  @Roles('ADMIN')
  @Get('admin/configs')
  adminConfigs() {
    return this.svc.listConfigs();
  }

  @Roles('ADMIN')
  @Put('admin/configs/:tier')
  async updateConfig(
    @Param('tier') tier: string,
    @Body() body: UpdateVipConfigDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!['GOLD', 'DIAMOND', 'SUPREME'].includes(tier)) {
      throw new NotFoundException('不存在的等级');
    }
    return this.svc.updateConfig(
      tier as Exclude<VipTier, 'NONE'>,
      body,
      { id: user.sub, username: user.username },
    );
  }

  @Roles('ADMIN')
  @Get('admin/discounts')
  adminDiscounts(@Query('productSource') productSource?: ProductSource) {
    return this.svc.listAllDiscounts(
      productSource ? { productSource } : {},
    );
  }

  @Roles('ADMIN')
  @Post('admin/discounts')
  upsertDiscount(
    @Body() body: UpsertProductDiscountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.upsertDiscount(
      {
        productSource: body.productSource as ProductSource,
        productKey: body.productKey,
        tier: body.tier as Exclude<VipTier, 'NONE'>,
        discount: body.discount,
      },
      { id: user.sub, username: user.username },
    );
  }

  @Roles('ADMIN')
  @Delete('admin/discounts/:id')
  removeDiscount(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.removeDiscount(id, { id: user.sub, username: user.username });
  }

  @Roles('ADMIN')
  @Get('admin/users')
  listUsers(@Query() q: ListUserVipDto) {
    return this.svc.listUsersVip(q.page || 1, q.pageSize || 20, {
      keyword: q.keyword,
      tier: q.tier as VipTier | undefined,
    });
  }

  @Roles('ADMIN')
  @Post('admin/users/:id/set')
  manualSet(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ManualSetVipDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.manualSet(
      id,
      body.tier as VipTier,
      { id: user.sub, username: user.username },
      body.note,
    );
  }

  /** 管理员：设置/清除某用户的专属折扣 */
  @Roles('ADMIN')
  @Post('admin/users/:id/discount')
  setUserDiscount(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetUserDiscountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.setUserCustomDiscount(
      id,
      body.discount,
      { id: user.sub, username: user.username },
      body.note,
    );
  }
}
