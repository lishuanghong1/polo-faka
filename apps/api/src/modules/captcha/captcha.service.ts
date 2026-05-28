import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import * as svgCaptcha from 'svg-captcha';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

const CAPTCHA_TTL_SECONDS = 120;
const REDIS_KEY = (id: string) => `captcha:${id}`;

export interface CaptchaPayload {
  id: string;
  svg: string;
  expiresIn: number;
}

@Injectable()
export class CaptchaService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async issue(): Promise<CaptchaPayload> {
    const c = svgCaptcha.create({
      size: 4,
      noise: 3,
      ignoreChars: '0o1ilI',
      color: true,
      background: '#f3f4f6',
      width: 130,
      height: 42,
      fontSize: 48,
    });
    const id = nanoid(16);
    await this.redis.set(
      REDIS_KEY(id),
      c.text.toLowerCase(),
      'EX',
      CAPTCHA_TTL_SECONDS,
    );
    return { id, svg: c.data, expiresIn: CAPTCHA_TTL_SECONDS };
  }

  /**
   * 校验验证码：无论成功失败，命中过的 ID 都会被立即删除，防止重放 / 暴力。
   * 失败抛 BadRequestException，方便上游直接转译给前端并触发刷新。
   */
  async verifyOrThrow(id?: string, code?: string): Promise<void> {
    if (!id || !code) {
      throw new BadRequestException('请先完成图形验证');
    }
    const trimmed = code.trim().toLowerCase();
    if (trimmed.length < 3 || trimmed.length > 8) {
      throw new BadRequestException('验证码格式错误');
    }
    const key = REDIS_KEY(id);
    const stored = await this.redis.get(key);
    if (!stored) {
      throw new BadRequestException('验证码已过期，请刷新后重试');
    }
    await this.redis.del(key);
    if (stored !== trimmed) {
      throw new BadRequestException('验证码错误，请刷新后重试');
    }
  }
}
