import { Module, forwardRef } from '@nestjs/common';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';
import { AlipayModule } from '../alipay/alipay.module';

@Module({
  imports: [forwardRef(() => AlipayModule)],
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
