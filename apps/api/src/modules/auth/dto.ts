import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

class CaptchaFields {
  @IsString()
  @MaxLength(32)
  captchaId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(8)
  @Matches(/^[a-zA-Z0-9]+$/, { message: '验证码格式错误' })
  captchaCode: string;
}

export class RegisterDto extends CaptchaFields {
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  inviteCode?: string;
}

export class LoginDto extends CaptchaFields {
  @IsString()
  username: string;

  @IsString()
  password: string;
}
