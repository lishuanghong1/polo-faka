import { Module } from '@nestjs/common';
import { AccountVaultService } from './account-vault.service';
import { AccountVaultController } from './account-vault.controller';

@Module({
  controllers: [AccountVaultController],
  providers: [AccountVaultService],
})
export class AccountVaultModule {}
