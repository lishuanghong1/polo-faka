import { Global, Module } from '@nestjs/common';
import { AbuseGuardService } from './abuse-guard.service';
import { AbuseAdminController } from './abuse.controller';
import { IpBlacklistMiddleware } from './ip-blacklist.middleware';

@Global()
@Module({
  controllers: [AbuseAdminController],
  providers: [AbuseGuardService, IpBlacklistMiddleware],
  exports: [AbuseGuardService, IpBlacklistMiddleware],
})
export class AbuseModule {}
