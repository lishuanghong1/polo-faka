import { Module } from '@nestjs/common';
import { PoolController } from './pool.controller';
import { PoolService } from './pool.service';
import { PoolQuotaChecker } from './quota-checker';

@Module({
  controllers: [PoolController],
  providers: [PoolService, PoolQuotaChecker],
  exports: [PoolService],
})
export class PoolModule {}
