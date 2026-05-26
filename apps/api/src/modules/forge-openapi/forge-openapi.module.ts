import { Module } from '@nestjs/common';
import { ForgeOpenapiService } from './forge-openapi.service';

@Module({
  providers: [ForgeOpenapiService],
  exports: [ForgeOpenapiService],
})
export class ForgeOpenapiModule {}
