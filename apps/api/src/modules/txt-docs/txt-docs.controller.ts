import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import * as os from 'os';
import { Roles } from '../../common/decorators/roles.decorator';
import { fixMultipartFilename, MAX_CONTENT_BYTES, toPlainText, TxtDocsService } from './txt-docs.service';

/** 单次最多上传的文件数 */
const MAX_UPLOAD_FILES = 20;

/** 查询串里的 1 / true / "" 都算真，其余算假 */
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1' || value === '';

class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}

class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}

class ListDocsQueryDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  categoryId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  keyword?: string;

  /** 是否连正文一起搜。MEDIUMTEXT 上是全表扫描，默认关闭 */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  searchContent?: boolean;

  @IsOptional()
  @IsInt()
  @IsPositive()
  page?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  pageSize?: number;
}

class CreateDocDto {
  @IsInt()
  @IsPositive()
  categoryId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  title!: string;

  @IsString()
  @MaxLength(MAX_CONTENT_BYTES)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}

class UpdateDocDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  categoryId?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_BYTES)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}

class BulkIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids!: number[];
}

class MoveDocsDto extends BulkIdsDto {
  @IsInt()
  @IsPositive()
  categoryId!: number;
}

@ApiTags('txt-docs')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('txt')
export class TxtDocsController {
  constructor(private svc: TxtDocsService) {}

  // ───────────────────────── 分类 ─────────────────────────

  @Get('categories')
  listCategories() {
    return this.svc.listCategories();
  }

  @Post('categories')
  createCategory(@Body() body: CreateCategoryDto) {
    return this.svc.createCategory(body);
  }

  @Put('categories/:id')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateCategoryDto) {
    return this.svc.updateCategory(id, body);
  }

  @Delete('categories/:id')
  removeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.svc.removeCategory(id);
  }

  // ───────────────────────── 文档 ─────────────────────────

  @Get('docs')
  listDocs(@Query() query: ListDocsQueryDto) {
    return this.svc.listDocs(query);
  }

  @Get('docs/:id')
  getDoc(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getDoc(id);
  }

  @Post('docs')
  createDoc(@Body() body: CreateDocDto) {
    return this.svc.createDoc(body);
  }

  @Put('docs/:id')
  updateDoc(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateDocDto) {
    return this.svc.updateDoc(id, body);
  }

  @Delete('docs/:id')
  removeDoc(@Param('id', ParseIntPipe) id: number) {
    return this.svc.removeDoc(id);
  }

  @Post('docs/bulk-remove')
  bulkRemove(@Body() body: BulkIdsDto) {
    return this.svc.bulkRemove(body.ids);
  }

  @Post('docs/move')
  move(@Body() body: MoveDocsDto) {
    return this.svc.moveDocs(body.ids, body.categoryId);
  }

  @Post('docs/upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        categoryId: { type: 'string' },
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
      required: ['categoryId', 'files'],
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', MAX_UPLOAD_FILES, {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, file, cb) => {
          const safe = (file.originalname || 'upload.txt').replace(/[^\w.\-]+/g, '_');
          cb(null, `polo-txt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
        },
      }),
      limits: { fileSize: MAX_CONTENT_BYTES, files: MAX_UPLOAD_FILES },
      fileFilter: (_req, file, cb) => {
        if (!/\.txt$/i.test(file.originalname || '')) {
          cb(new BadRequestException(`「${fixMultipartFilename(file.originalname || '')}」不是 .txt 文件`), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  upload(@UploadedFiles() files: Express.Multer.File[], @Body('categoryId') categoryId?: string) {
    const id = Number(categoryId);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('请先选择分类');
    return this.svc.importFiles(id, files || []);
  }

  /**
   * 导出单条为 .txt。这里绕开全局 TransformInterceptor 直接写响应体，
   * 否则文件内容会被 { success, data } 包一层。
   */
  @Get('docs/:id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const doc = await this.svc.getDoc(id);
    const name = doc.filename || `${doc.title}.txt`;
    const ascii = name.replace(/[^\w.\-]+/g, '_') || 'document.txt';

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    // 带 BOM 输出，Windows 记事本才不会把中文认成 GBK。富文本下载成可读纯文本。
    const plain = toPlainText(doc.content);
    res.send(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(plain, 'utf8')]));
  }
}
