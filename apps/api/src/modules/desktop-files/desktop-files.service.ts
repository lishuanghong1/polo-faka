import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

export type DesktopFileKind = 'exe' | 'dmg';

export const DESKTOP_FILE_NAMES: Record<DesktopFileKind, string> = {
  exe: 'polo.exe',
  dmg: 'polo.dmg',
};

export interface DesktopFileInfo {
  kind: DesktopFileKind;
  name: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
  url: string;
}

export interface DesktopFilesStatus {
  dir: string;
  version: string;
  releasedAt: string | null;
  urlBase: string;
  files: DesktopFileInfo[];
}

@Injectable()
export class DesktopFilesService implements OnModuleInit {
  private readonly logger = new Logger(DesktopFilesService.name);
  private dir = '';
  private version = 'manual';

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const configured = this.config.get<string>('DESKTOP_STATIC_DIR')?.trim();
    this.dir = configured
      ? path.resolve(configured)
      : path.resolve(process.cwd(), 'data', 'desktop-static');
    fs.mkdir(this.dir, { recursive: true }).catch((e) => {
      this.logger.warn(`无法创建桌面安装包目录 ${this.dir}: ${e?.message || e}`);
    });
    this.logger.log(`Desktop files dir: ${this.dir}`);
  }

  getDir() {
    return this.dir;
  }

  private resolveKind(kind: string): DesktopFileKind {
    if (kind === 'exe' || kind === 'dmg') return kind;
    throw new BadRequestException('kind 仅支持 exe / dmg');
  }

  private filePath(kind: DesktopFileKind) {
    return path.join(this.dir, DESKTOP_FILE_NAMES[kind]);
  }

  private async ensureDir() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private async assertWritable() {
    await this.ensureDir();
    const probe = path.join(this.dir, `.write-probe-${process.pid}`);
    try {
      await fs.writeFile(probe, 'ok');
      await fs.unlink(probe);
    } catch (e: any) {
      this.logger.error(`desktop dir not writable: ${this.dir} (${e?.code || ''} ${e?.message || e})`);
      throw new ServiceUnavailableException(
        `桌面安装包目录不可写：${this.dir}。请重新部署 API（入口会自动 chown），或在服务器执行 chmod 777 deploy/static/desktop`,
      );
    }
  }

  private mapFsError(e: any, action: string): never {
    const code = e?.code || '';
    this.logger.error(`${action} failed: ${code} ${e?.message || e}`);
    if (code === 'EACCES' || code === 'EPERM') {
      throw new ServiceUnavailableException(
        `桌面安装包目录无写权限：${this.dir}。请重新部署 API，或 chmod 777 deploy/static/desktop`,
      );
    }
    if (e instanceof BadRequestException || e instanceof NotFoundException || e instanceof ServiceUnavailableException) {
      throw e;
    }
    throw new ServiceUnavailableException(`保存安装包失败：${e?.message || code || '未知错误'}`);
  }

  private async loadVersionFromManifest() {
    try {
      const raw = await fs.readFile(path.join(this.dir, 'latest.json'), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.version) this.version = String(parsed.version);
    } catch {
      // ignore
    }
  }

  private async listFiles(): Promise<{ files: DesktopFileInfo[]; latestMs: number }> {
    const kinds: DesktopFileKind[] = ['exe', 'dmg'];
    const files: DesktopFileInfo[] = [];
    let latestMs = 0;

    for (const kind of kinds) {
      const name = DESKTOP_FILE_NAMES[kind];
      const fp = this.filePath(kind);
      let exists = false;
      let size = 0;
      let updatedAt: string | null = null;
      try {
        const st = await fs.stat(fp);
        if (st.isFile()) {
          exists = true;
          size = st.size;
          updatedAt = st.mtime.toISOString();
          latestMs = Math.max(latestMs, st.mtimeMs);
        }
      } catch {
        // missing
      }
      files.push({
        kind,
        name,
        exists,
        size,
        updatedAt,
        url: `/static/desktop/${encodeURIComponent(name)}`,
      });
    }
    return { files, latestMs };
  }

  async status(): Promise<DesktopFilesStatus> {
    try {
      await this.ensureDir();
    } catch {
      // 目录不可建时仍尽量返回空状态，避免管理页整页 500
    }
    await this.loadVersionFromManifest();
    const { files, latestMs } = await this.listFiles();

    return {
      dir: this.dir,
      version: this.version,
      releasedAt: latestMs ? new Date(latestMs).toISOString() : null,
      urlBase: '/static/desktop/',
      files,
    };
  }

  async saveUpload(
    kindRaw: string,
    tempPath: string,
    originalName: string,
    opts?: { version?: string },
  ) {
    const kind = this.resolveKind(kindRaw);
    const lower = (originalName || '').toLowerCase();
    if (kind === 'exe' && !lower.endsWith('.exe')) {
      throw new BadRequestException('Windows 安装包请上传 .exe 文件');
    }
    if (kind === 'dmg' && !lower.endsWith('.dmg')) {
      throw new BadRequestException('macOS 安装包请上传 .dmg 文件');
    }

    await this.assertWritable();
    const dest = this.filePath(kind);
    const tmpDest = `${dest}.uploading`;

    try {
      try {
        await pipeline(createReadStream(tempPath), createWriteStream(tmpDest));
        try {
          await fs.rename(tmpDest, dest);
        } catch {
          await fs.copyFile(tmpDest, dest);
          await fs.unlink(tmpDest).catch(() => undefined);
        }
      } catch (e) {
        this.mapFsError(e, `save ${DESKTOP_FILE_NAMES[kind]}`);
      }

      if (opts?.version?.trim()) {
        this.version = opts.version.trim();
      }
      try {
        await this.writeManifest();
      } catch (e) {
        this.mapFsError(e, 'write latest.json');
      }
      return this.status();
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
      await fs.unlink(tmpDest).catch(() => undefined);
    }
  }

  async remove(kindRaw: string) {
    const kind = this.resolveKind(kindRaw);
    const fp = this.filePath(kind);
    try {
      await fs.unlink(fp);
    } catch {
      throw new NotFoundException(`${DESKTOP_FILE_NAMES[kind]} 不存在`);
    }
    await this.writeManifest();
    return this.status();
  }

  /** 供前台 DesktopTool 使用的 latest.json */
  async writeManifest() {
    await this.ensureDir();
    const { files, latestMs } = await this.listFiles();
    type ManifestAsset = {
      name: string;
      size: number;
      platform: 'windows' | 'macos-arm' | 'macos-intel';
      kind: 'exe' | 'dmg';
    };
    const assets: ManifestAsset[] = [];
    for (const f of files) {
      if (!f.exists) continue;
      if (f.kind === 'exe') {
        assets.push({ name: f.name, size: f.size, platform: 'windows', kind: 'exe' });
      } else {
        // 同一份 dmg 同时给 arm / intel 下载入口
        assets.push({ name: f.name, size: f.size, platform: 'macos-arm', kind: 'dmg' });
        assets.push({ name: f.name, size: f.size, platform: 'macos-intel', kind: 'dmg' });
      }
    }

    const manifest = {
      version: this.version || 'manual',
      tag: this.version || 'manual',
      releasedAt: latestMs ? new Date(latestMs).toISOString() : new Date().toISOString(),
      urlBase: '/static/desktop/',
      assets,
    };

    await fs.writeFile(
      path.join(this.dir, 'latest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    return manifest;
  }
}
