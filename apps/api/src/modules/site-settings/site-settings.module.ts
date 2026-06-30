import { Module, forwardRef } from '@nestjs/common';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';
import { AlipayModule } from '../alipay/alipay.module';
import { ForgeOpenapiModule } from '../forge-openapi/forge-openapi.module';
import { AizhpOpenModule } from '../aizhp-open/aizhp-open.module';

@Module({
  imports: [forwardRef(() => AlipayModule), forwardRef(() => ForgeOpenapiModule), forwardRef(() => AizhpOpenModule)],
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
