import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRechargeDto {
  /** 充值金额 CNY，0.01 ~ 10000 */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: '金额最多保留 2 位小数' })
  @Min(0.01, { message: '充值金额不能小于 0.01' })
  @Max(10000, { message: '单笔充值金额上限 10000' })
  amount: number;
}

export class ListMyRechargeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
