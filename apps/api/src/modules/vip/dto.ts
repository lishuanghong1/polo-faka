import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum VipTierDto {
  GOLD = 'GOLD',
  DIAMOND = 'DIAMOND',
  SUPREME = 'SUPREME',
}

export enum ProductSourceDto {
  LOCAL = 'LOCAL',
  FORGE = 'FORGE',
}

export class UpdateVipConfigDto {
  @IsString() @MaxLength(32)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  threshold!: number;

  /** 0.5 ~ 1，0.95 = 95 折。低于 0.5 拒绝（防呆） */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.5)
  @Max(1)
  defaultDiscount!: number;

  @IsOptional() @IsString() @MaxLength(32)
  color?: string;

  @IsOptional() @IsString() @MaxLength(32)
  icon?: string;

  @IsOptional()
  benefits?: string[];
}

export class UpsertProductDiscountDto {
  @IsEnum(ProductSourceDto)
  productSource!: ProductSourceDto;

  @IsString() @MaxLength(64)
  productKey!: string;

  @IsEnum(VipTierDto)
  tier!: VipTierDto;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.5)
  @Max(1)
  discount!: number;
}

export class ManualSetVipDto {
  @IsEnum(['NONE', 'GOLD', 'DIAMOND', 'SUPREME'])
  tier!: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';

  @IsOptional() @IsString() @MaxLength(255)
  note?: string;
}

export class PreviewDiscountDto {
  @IsEnum(ProductSourceDto)
  productSource!: ProductSourceDto;

  @IsString() @MaxLength(64)
  productKey!: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  originalAmount!: number;
}

export class ListUserVipDto {
  @IsOptional() @IsInt() @Type(() => Number) @Min(1)
  page?: number;

  @IsOptional() @IsInt() @Type(() => Number) @Min(1) @Max(200)
  pageSize?: number;

  @IsOptional() @IsString() @MaxLength(64)
  keyword?: string;

  @IsOptional() @IsEnum(['NONE', 'GOLD', 'DIAMOND', 'SUPREME'])
  tier?: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
}
