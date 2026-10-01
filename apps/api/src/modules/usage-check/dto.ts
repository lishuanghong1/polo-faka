import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UsageCheckDto {
  // Preserve the submitted type even with the application's implicit conversion.
  @Transform(({ obj }) => obj.token, { toClassOnly: true })
  @IsString({ message: '请提供 Cursor Token' })
  @IsNotEmpty({ message: '请提供 Cursor Token' })
  @MaxLength(8192, { message: 'Token 长度异常' })
  token: string;
}
