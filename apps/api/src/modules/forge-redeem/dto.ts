import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class GenerateForgeCodesDto {
  @ApiProperty({ description: '面额（CNY）' })
  @IsNumber()
  @Min(0.01)
  totalAmount!: number;

  @ApiProperty({ description: '生成数量', minimum: 1, maximum: 5000 })
  @IsInt()
  @Min(1)
  @Max(5000)
  count!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  expireAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ required: false, description: '兑换码前缀，默认 FK' })
  @IsOptional()
  @IsString()
  prefix?: string;
}

export class UpdateForgeProductDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  displayPrice?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  pointsAwardEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pointsPayEnabled?: boolean;

  // ── 自定义详情：null/空串 = 清空回退到三方默认 ─────────
  @IsOptional()
  @IsString()
  @Length(0, 128)
  customName?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  customCategoryName?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  subtitle?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 512)
  coverImage?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 20000)
  description?: string | null;

  /** JSON 数组字符串，如 ["秒到账","30天质保"] */
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  highlights?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  notice?: string | null;
}

export class RedeemCheckDto {
  @IsString()
  @Length(4, 64)
  code!: string;
}

export class RedeemOrderDto {
  @IsString()
  @Length(4, 64)
  code!: string;

  @IsString()
  @Length(1, 64)
  typeKey!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  contact?: string;
}

export class AlipayOrderDto {
  @IsString()
  @Length(1, 64)
  typeKey!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  contact?: string;
}

export class BalanceOrderDto {
  @IsString()
  @Length(1, 64)
  typeKey!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  contact?: string;
}

export class PointsOrderDto extends BalanceOrderDto {}

export class OrderQueryDto {
  @IsString()
  @Length(1, 64)
  orderNo!: string;

  @IsOptional()
  @IsString()
  contact?: string;
}
