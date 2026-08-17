import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import * as iconv from 'iconv-lite';
import { PrismaService } from '../../prisma/prisma.service';

/** 摘要字数，与 schema 里 preview 列的 VarChar(200) 对齐 */
const PREVIEW_CHARS = 200;

/** 单条正文上限。MEDIUMTEXT 物理上限 16MB，留一半余量给多字节字符 */
export const MAX_CONTENT_BYTES = 8 * 1024 * 1024;

/** 列表用字段集：刻意不含 content，避免读 MEDIUMTEXT 的溢出页 */
const LIST_SELECT = {
  id: true,
  categoryId: true,
  title: true,
  preview: true,
  filename: true,
  size: true,
  remark: true,
  sort: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.TxtDocumentSelect;

export interface ImportedFile {
  originalname: string;
  path: string;
}

/**
 * 按 BOM 和字节特征还原文本。
 * Windows 记事本 / Excel 导出的 txt 多为 GBK，直接按 UTF-8 读会整篇乱码。
 */
function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8-bom' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: iconv.decode(buf.subarray(2), 'utf16-le'), encoding: 'utf-16le' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: iconv.decode(buf.subarray(2), 'utf16-be'), encoding: 'utf-16be' };
  }
  // 无 BOM：先当 UTF-8 解，出现替换字符说明字节序列非法，回退 GBK
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('\ufffd')) return { text: asUtf8, encoding: 'utf-8' };
  return { text: iconv.decode(buf, 'gbk'), encoding: 'gbk' };
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** wangEditor 保存后的正文会带块级标签；纯文本教程里偶发的 `<email>` 不能当 HTML 剥 */
function looksLikeRichHtml(s: string) {
  return /<(p|h[1-6]|ul|ol|li|blockquote|pre|table|div|span)(\s|\/|>)/i.test(s);
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/** 下载 / 摘要用：把富文本还原成可读纯文本，旧的纯文本原样返回 */
export function toPlainText(content: string) {
  if (!content || !looksLikeRichHtml(content)) return content ?? '';
  const withBreaks = content
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withBreaks).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function makePreview(content: string) {
  const flat = toPlainText(content).replace(/\s+/g, ' ').trim();
  // 按码点切，避免把代理对切成孤立代理导致 MySQL 存入非法 UTF-8
  const chars = Array.from(flat);
  return chars.length <= PREVIEW_CHARS ? flat : chars.slice(0, PREVIEW_CHARS).join('');
}

/**
 * 还原 multipart 里的中文文件名。
 * busboy 按 latin1 解 Content-Disposition 的 filename，「报表.txt」会变成「æ¥è¡¨.txt」。
 * 把字符按字节还原再用 UTF-8 解一次即可；无法还原时保持原样。
 */
export function fixMultipartFilename(name: string) {
  if (!name) return name;
  // 含超出 latin1 范围的字符，说明解析器已经给出正确 UTF-8，不要动
  if (/[^\x00-\xff]/.test(name)) return name;
  if (/^[\x00-\x7f]*$/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}

/** 去掉扩展名的文件名，用作导入时的默认标题 */
function titleFromFilename(name: string) {
  const base = (name || '').replace(/\.[^.]+$/, '').trim();
  return (base || '未命名').slice(0, 128);
}

@Injectable()
export class TxtDocsService {
  constructor(private prisma: PrismaService) {}

  // ───────────────────────── 分类 ─────────────────────────

  async listCategories() {
    const rows = await this.prisma.txtCategory.findMany({
      orderBy: [{ sort: 'desc' }, { id: 'asc' }],
      include: { _count: { select: { docs: true } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, docCount: _count.docs }));
  }

  async createCategory(data: { name: string; remark?: string; sort?: number }) {
    const name = data.name.trim();
    if (!name) throw new BadRequestException('分类名不能为空');
    try {
      return await this.prisma.txtCategory.create({
        data: { name, remark: data.remark?.trim() || null, sort: data.sort ?? 0 },
      });
    } catch (e) {
      throw this.mapWriteError(e, name);
    }
  }

  async updateCategory(id: number, data: { name?: string; remark?: string; sort?: number }) {
    await this.getCategoryOrThrow(id);
    const name = data.name?.trim();
    if (data.name !== undefined && !name) throw new BadRequestException('分类名不能为空');
    try {
      return await this.prisma.txtCategory.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(data.remark !== undefined ? { remark: data.remark.trim() || null } : {}),
          ...(data.sort !== undefined ? { sort: data.sort } : {}),
        },
      });
    } catch (e) {
      throw this.mapWriteError(e, name ?? '');
    }
  }

  async removeCategory(id: number) {
    await this.getCategoryOrThrow(id);
    const docCount = await this.prisma.txtDocument.count({ where: { categoryId: id } });
    if (docCount > 0) {
      throw new BadRequestException(`该分类下还有 ${docCount} 条文本，请先移动或删除后再删分类`);
    }
    await this.prisma.txtCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────────────── 文档 ─────────────────────────

  async listDocs(q: {
    categoryId?: number;
    keyword?: string;
    searchContent?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, q.page || 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize || 20));

    const where: Prisma.TxtDocumentWhereInput = {};
    if (q.categoryId) where.categoryId = q.categoryId;

    const kw = q.keyword?.trim();
    if (kw) {
      // MySQL 默认 utf8mb4_unicode_ci 已不区分大小写，无需 Prisma 的 insensitive 模式
      where.OR = [
        { title: { contains: kw } },
        { remark: { contains: kw } },
        { filename: { contains: kw } },
        // 正文搜索是 MEDIUMTEXT 上的全表扫描，默认关闭，由前端显式勾选
        ...(q.searchContent ? [{ content: { contains: kw } }] : []),
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.txtDocument.count({ where }),
      this.prisma.txtDocument.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ sort: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async getDoc(id: number) {
    const doc = await this.prisma.txtDocument.findUnique({
      where: { id },
      include: { category: { select: { id: true, name: true } } },
    });
    if (!doc) throw new NotFoundException('文本不存在');
    return doc;
  }

  async createDoc(data: {
    categoryId: number;
    title: string;
    content: string;
    remark?: string;
    sort?: number;
    filename?: string;
  }) {
    await this.getCategoryOrThrow(data.categoryId);
    const content = this.normalizeContent(data.content);
    const title = data.title.trim();
    if (!title) throw new BadRequestException('标题不能为空');

    return this.prisma.txtDocument.create({
      data: {
        categoryId: data.categoryId,
        title,
        content,
        preview: makePreview(content),
        size: Buffer.byteLength(content, 'utf8'),
        filename: data.filename?.slice(0, 255) || null,
        remark: data.remark?.trim() || null,
        sort: data.sort ?? 0,
      },
      select: LIST_SELECT,
    });
  }

  async updateDoc(
    id: number,
    data: {
      categoryId?: number;
      title?: string;
      content?: string;
      remark?: string;
      sort?: number;
    },
  ) {
    await this.getDocOrThrow(id);
    if (data.categoryId !== undefined) await this.getCategoryOrThrow(data.categoryId);

    const patch: Prisma.TxtDocumentUpdateInput = {};
    if (data.categoryId !== undefined) {
      patch.category = { connect: { id: data.categoryId } };
    }
    if (data.title !== undefined) {
      const title = data.title.trim();
      if (!title) throw new BadRequestException('标题不能为空');
      patch.title = title;
    }
    if (data.content !== undefined) {
      const content = this.normalizeContent(data.content);
      patch.content = content;
      patch.preview = makePreview(content);
      patch.size = Buffer.byteLength(content, 'utf8');
    }
    if (data.remark !== undefined) patch.remark = data.remark.trim() || null;
    if (data.sort !== undefined) patch.sort = data.sort;

    return this.prisma.txtDocument.update({
      where: { id },
      data: patch,
      select: LIST_SELECT,
    });
  }

  async removeDoc(id: number) {
    await this.getDocOrThrow(id);
    await this.prisma.txtDocument.delete({ where: { id } });
    return { ok: true };
  }

  async bulkRemove(ids: number[]) {
    if (!ids.length) throw new BadRequestException('请选择要删除的文本');
    const { count } = await this.prisma.txtDocument.deleteMany({ where: { id: { in: ids } } });
    return { removed: count };
  }

  async moveDocs(ids: number[], categoryId: number) {
    if (!ids.length) throw new BadRequestException('请选择要移动的文本');
    await this.getCategoryOrThrow(categoryId);
    const { count } = await this.prisma.txtDocument.updateMany({
      where: { id: { in: ids } },
      data: { categoryId },
    });
    return { moved: count };
  }

  /**
   * 批量导入 .txt。逐个文件独立处理，单个失败不影响其余，
   * 结果里回传每个文件的成败与识别到的编码。
   */
  async importFiles(categoryId: number, files: ImportedFile[]) {
    await this.getCategoryOrThrow(categoryId);
    if (!files?.length) throw new BadRequestException('请选择要上传的 .txt 文件');

    const results: Array<{
      filename: string;
      ok: boolean;
      id?: number;
      encoding?: string;
      size?: number;
      error?: string;
    }> = [];

    for (const file of files) {
      const filename = fixMultipartFilename(file.originalname || '') || 'upload.txt';
      try {
        const buf = await fs.readFile(file.path);
        const { text, encoding } = decodeText(buf);
        const content = this.normalizeContent(text);
        const doc = await this.prisma.txtDocument.create({
          data: {
            categoryId,
            title: titleFromFilename(filename),
            content,
            preview: makePreview(content),
            size: Buffer.byteLength(content, 'utf8'),
            filename: filename.slice(0, 255),
          },
          select: { id: true, size: true },
        });
        results.push({ filename, ok: true, id: doc.id, encoding, size: doc.size });
      } catch (e: any) {
        results.push({ filename, ok: false, error: e?.message || '导入失败' });
      } finally {
        await fs.unlink(file.path).catch(() => undefined);
      }
    }

    return {
      total: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  // ───────────────────────── 内部 ─────────────────────────

  private normalizeContent(raw: string) {
    const content = this.sanitizeRichHtml(stripBom(raw ?? ''));
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_CONTENT_BYTES) {
      const mb = (MAX_CONTENT_BYTES / 1024 / 1024).toFixed(0);
      throw new BadRequestException(`正文超过 ${mb}MB 上限（当前 ${(bytes / 1024 / 1024).toFixed(2)}MB）`);
    }
    return content;
  }

  /** 正文会进富文本编辑器，存库前去掉脚本和行内事件，避免以后误用 v-html 时被带进去 */
  private sanitizeRichHtml(html: string) {
    if (!looksLikeRichHtml(html)) return html;
    return html
      .replace(/<(script|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
      .replace(/<(script|iframe|object|embed)[^>]*\/?>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  private async getCategoryOrThrow(id: number) {
    const cat = await this.prisma.txtCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('分类不存在');
    return cat;
  }

  private async getDocOrThrow(id: number) {
    const doc = await this.prisma.txtDocument.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('文本不存在');
    return doc;
  }

  private mapWriteError(e: unknown, name: string) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException(`分类「${name}」已存在`);
    }
    return e;
  }
}
