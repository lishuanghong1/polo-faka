import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCursorQuotaDto {
  @IsString()
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
  token?: string;

  @IsOptional()
  @IsString()
  purchasedAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchasePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  autoPricePerUsd?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number | null;
}

export class UpdateCursorQuotaDto {
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
  token?: string;

  @IsOptional()
  @IsString()
  purchasedAt?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchasePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  autoPricePerUsd?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number | null;
}

export class BulkImportCursorQuotaDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  autoPricePerUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchasePrice?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number | null;
}

export class QueryCursorQuotaDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  keyword?: string;

  /** 0 = 未分组，正整数 = 指定分组，不传 = 全部 */
  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  groupId?: number;

  @ValidateIf((_o, v) => v !== '' && v !== undefined && v !== null)
  @IsIn(['UNKNOWN', 'HEALTHY', 'LOW_QUOTA', 'EXHAUSTED', 'TOKEN_INVALID'])
  accountStatus?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @ValidateIf((_o, v) => v !== '' && v !== undefined && v !== null)
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class CreateCursorQuotaGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;
}

export class UpdateCursorQuotaGroupDto {
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

export class UpdateCursorQuotaModelSettingsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  premiumModels: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  autoModels: string[];
}
