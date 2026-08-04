import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as os from 'os';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DesktopFilesService } from './desktop-files.service';

const MAX_BYTES = 150 * 1024 * 1024; // 150MB

@ApiTags('desktop-files')
@Controller()
export class DesktopFilesController {
  constructor(private svc: DesktopFilesService) {}

  /** 前台/管理共用：当前已上传的安装包状态 */
  @Public()
  @Get('desktop-files')
  status() {
    return this.svc.status();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('admin/desktop-files')
  adminStatus() {
    return this.svc.status();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('admin/desktop-files/:kind')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        version: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, file, cb) => {
          const safe = (file.originalname || 'upload').replace(/[^\w.\-]+/g, '_');
          cb(null, `polo-desktop-${Date.now()}-${safe}`);
        },
      }),
      limits: { fileSize: MAX_BYTES },
    }),
  )
  async upload(
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('version') version?: string,
  ) {
    if (!file?.path) {
      throw new BadRequestException('请选择要上传的文件');
    }
    return this.svc.saveUpload(kind, file.path, file.originalname || '', {
      version,
    });
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Delete('admin/desktop-files/:kind')
  remove(@Param('kind') kind: string) {
    return this.svc.remove(kind);
  }
}
