import { Module } from '@nestjs/common';
import { EmailCodeController } from './email-code.controller';
import { EmailCodeService } from './email-code.service';

@Module({
  controllers: [EmailCodeController],
  providers: [EmailCodeService],
  exports: [EmailCodeService],
})
export class EmailCodeModule {}
