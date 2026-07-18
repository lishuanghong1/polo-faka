import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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
  @IsString()
  @MaxLength(500)
  note?: string;
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
  @IsString()
  @MaxLength(500)
  note?: string | null;
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
  purchasePrice?: number;
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
