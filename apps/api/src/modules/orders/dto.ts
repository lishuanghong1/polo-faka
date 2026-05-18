import { IsInt, IsOptional, IsString, Max, Min, IsEnum, MaxLength } from 'class-validator';

export enum PayMethodDto {
  ALIPAY = 'ALIPAY',
  WECHAT = 'WECHAT',
  BALANCE = 'BALANCE',
  USDT = 'USDT',
  MOCK = 'MOCK',
}

export class CreateOrderDto {
  @IsInt()
  productId: number;

  @IsInt()
  skuId: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;

  @IsEnum(PayMethodDto)
  payMethod: PayMethodDto;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;
}
