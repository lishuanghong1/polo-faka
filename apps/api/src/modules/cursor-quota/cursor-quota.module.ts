import { Module } from '@nestjs/common';
import { CursorUsageService } from './cursor-usage.service';
import { CursorQuotaService } from './cursor-quota.service';
import { CursorQuotaController } from './cursor-quota.controller';
import { CursorQuotaCron } from './cursor-quota.cron';

@Module({
  controllers: [CursorQuotaController],
  providers: [CursorUsageService, CursorQuotaService, CursorQuotaCron],
  exports: [CursorQuotaService],
})
export class CursorQuotaModule {}
