import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export const VAULT_STATUSES = ['AVAILABLE', 'USED', 'DISABLED'] as const;
export type VaultStatus = (typeof VAULT_STATUSES)[number];

export const VAULT_IMPORT_FIELDS = ['email', 'password', 'emailPassword', 'token', 'note'] as const;
export const VAULT_EXPORT_FIELDS = [
  'email',
  'password',
  'emailPassword',
  'token',
  'status',
  'tags',
  'note',
] as const;

export class QueryVaultDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  keyword?: string;

  @ValidateIf((_o, v) => v !== '' && v !== undefined && v !== null)
  @IsIn(VAULT_STATUSES as unknown as string[])
  status?: string;

  /** 0 = 未分组，正整数 = 指定分组，不传 = 全部 */
  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  groupId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchTag?: string;

  @ValidateIf((_o, v) => v !== '' && v !== undefined && v !== null)
  @IsIn(['VALID', 'INVALID', 'ERROR', 'UNCHECKED'])
  checkResult?: string;

  /** '1' = 只看 7 天内到期 */
  @IsOptional()
  @IsString()
  expiring?: string;

  /** '1' = 回收站 */
  @IsOptional()
  @IsString()
  recycled?: string;
}

export class QueryVaultEventsDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 20;
}

export class CreateVaultAccountDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  emailPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  token?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number | null;

  @IsOptional()
  @IsIn(VAULT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tags?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}

export class UpdateVaultAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  email?: string;

  /** 传空串 = 清除该字段 */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  emailPassword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  token?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number | null;

  @IsOptional()
  @IsIn(VAULT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tags?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}

export class BulkImportVaultDto {
  @IsString()
  @MinLength(1)
  text: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  separator?: string;

  /** 每列含义，默认 ['email','password','emailPassword','token'] */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsIn(VAULT_IMPORT_FIELDS as unknown as string[], { each: true })
  fields?: string[];

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number | null;

  @IsOptional()
  @IsIn(VAULT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tags?: string;
}

export class BulkActionVaultDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @Type(() => Number)
  @IsInt({ each: true })
  ids: number[];

  @IsIn(['delete', 'restore', 'purge', 'status', 'move'])
  action: 'delete' | 'restore' | 'purge' | 'status' | 'move';

  @IsOptional()
  @IsIn(VAULT_STATUSES as unknown as string[])
  status?: string;

  /** move 时使用；null / 不传 = 移出分组 */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number | null;
}

export class ExportVaultDto {
  /** 指定 id 导出；不传则按筛选条件导出 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @Type(() => Number)
  @IsInt({ each: true })
  ids?: number[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsIn(VAULT_EXPORT_FIELDS as unknown as string[], { each: true })
  fields: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  separator?: string;

  // ── 按筛选导出时的条件（与 QueryVaultDto 对齐） ──
  @IsOptional()
  @IsString()
  keyword?: string;

  @ValidateIf((_o, v) => v !== '' && v !== undefined && v !== null)
  @IsIn(VAULT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  groupId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchTag?: string;

  @IsOptional()
  @IsString()
  recycled?: string;
}

export class CheckBatchVaultDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  ids: number[];
}

export class CreateVaultGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;
}

export class UpdateVaultGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;
}
