import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateCursorSubDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  emailPassword?: string;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  cursorToken?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  subscriptionDays?: number;
}

export class UpdateCursorSubDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  emailPassword?: string;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  cursorToken?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  subscriptionDays?: number;
}

export class BulkImportCursorSubDto {
  @IsString()
  @Length(1, 200000)
  text!: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  separator?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  subscriptionDays?: number;
}

/** 迁移导入：cursor-jb 导出的已解密账号（含订阅状态） */
export class MigrateCursorSubItemDto {
  @IsOptional()
  @IsInt()
  oldId?: number;

  @IsEmail()
  email!: string;

  @IsOptional() @IsString() @Length(0, 500)
  password?: string;

  @IsOptional() @IsString() @Length(0, 500)
  emailPassword?: string;

  @IsOptional() @IsString() @Length(0, 4000)
  cursorToken?: string;

  @IsOptional() @IsString() @Length(0, 500)
  note?: string;

  @IsOptional() @IsString() @Length(0, 16)
  status?: string;

  @IsOptional() @IsString()
  paidAt?: string;

  @IsOptional() @IsString()
  expiresAt?: string;

  @IsOptional() @IsInt() @Min(1) @Max(3650)
  subscriptionDays?: number;
}
