import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
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

  @ApiProperty({ required: false, description: '过期时间 ISO 字符串' })
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
}
