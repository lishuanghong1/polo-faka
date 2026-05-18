import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AdminIpAllowlistMiddleware } from './common/middleware/admin-ip-allowlist.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CardKeysModule } from './modules/card-keys/card-keys.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { SiteSettingsModule } from './modules/site-settings/site-settings.module';
import { FeedbacksModule } from './modules/feedbacks/feedbacks.module';
import { PoolModule } from './modules/pool/pool.module';
import { AdminModule } from './modules/admin/admin.module';
import { PayModule } from './modules/pay/pay.module';
import { AlipayModule } from './modules/alipay/alipay.module';
import { AuditModule } from './modules/audit/audit.module';
import { RedeemModule } from './modules/redeem/redeem.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      // 默认：每分钟 120 次，避免误伤；接口级用 @Throttle 覆盖更严限制
      { ttl: 60_000, limit: 120 },
    ]),
    PrismaModule,
    RedisModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    OrdersModule,
    CardKeysModule,
    AnnouncementsModule,
    SiteSettingsModule,
    FeedbacksModule,
    PoolModule,
    PayModule,
    AlipayModule,
    RedeemModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AdminIpAllowlistMiddleware,
  ],
})
export class AppModule {}
