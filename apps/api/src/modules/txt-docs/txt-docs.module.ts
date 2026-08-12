import { Module } from '@nestjs/common';
import { TxtDocsController } from './txt-docs.controller';
import { TxtDocsService } from './txt-docs.service';

@Module({
  controllers: [TxtDocsController],
  providers: [TxtDocsService],
  exports: [TxtDocsService],
})
export class TxtDocsModule {}
