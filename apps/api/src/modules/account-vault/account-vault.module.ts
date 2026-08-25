import { Module } from '@nestjs/common';
import { AccountVaultService } from './account-vault.service';
import { AccountVaultController } from './account-vault.controller';
import { CursorUsageService } from '../cursor-quota/cursor-usage.service';

@Module({
  controllers: [AccountVaultController],
  providers: [AccountVaultService, CursorUsageService],
})
export class AccountVaultModule {}
