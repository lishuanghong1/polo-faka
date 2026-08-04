import { Module } from '@nestjs/common';
import { DesktopFilesController } from './desktop-files.controller';
import { DesktopFilesService } from './desktop-files.service';

@Module({
  controllers: [DesktopFilesController],
  providers: [DesktopFilesService],
  exports: [DesktopFilesService],
})
export class DesktopFilesModule {}
