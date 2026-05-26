import { Module } from '@nestjs/common';
import { ForgeRedeemService } from './forge-redeem.service';
import { ForgeRedeemController } from './forge-redeem.controller';
import { ForgeRedeemAdminController } from './forge-redeem-admin.controller';
import { ForgeOpenapiModule } from '../forge-openapi/forge-openapi.module';

@Module({
  imports: [ForgeOpenapiModule],
  controllers: [ForgeRedeemController, ForgeRedeemAdminController],
  providers: [ForgeRedeemService],
  exports: [ForgeRedeemService],
})
export class ForgeRedeemModule {}
