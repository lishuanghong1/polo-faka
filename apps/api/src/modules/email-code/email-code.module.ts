import { Module } from '@nestjs/common';
import { EmailCodeController } from './email-code.controller';
import { EmailCodeService } from './email-code.service';
import { ForgeOpenapiModule } from '../forge-openapi/forge-openapi.module';
import { AizhpOpenModule } from '../aizhp-open/aizhp-open.module';

@Module({
  imports: [ForgeOpenapiModule, AizhpOpenModule],
  controllers: [EmailCodeController],
  providers: [EmailCodeService],
  exports: [EmailCodeService],
})
export class EmailCodeModule {}
