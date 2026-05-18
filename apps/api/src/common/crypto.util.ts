import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('CryptoUtil');

/**
 * 派生 256-bit key：
 * 优先 POOL_ENCRYPTION_KEY（hex/base64/明文都接受，会做 sha256 归一）
 * 没设的话用 JWT_SECRET 兜底（仍然给出警告）。
 */
function getKey(): Buffer {
  const raw = process.env.POOL_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!raw) {
    throw new Error(
      '必须设置环境变量 POOL_ENCRYPTION_KEY（或 JWT_SECRET），用于加密号池 Token',
    );
  }
  if (!process.env.POOL_ENCRYPTION_KEY) {
    logger.warn(
      '未单独设置 POOL_ENCRYPTION_KEY，正在使用 JWT_SECRET 派生加密密钥；建议生产环境单独设置一个强随机串。',
    );
  }
  return createHash('sha256').update(raw).digest();
}

/**
 * 加密字符串。
 * 返回格式：v1:base64(iv):base64(cipher):base64(authTag)
 */
export function encryptString(plain: string): string {
  if (!plain) return plain;
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`;
}

/**
 * 解密。若发现是旧的明文（无 v1 前缀），原样返回（向后兼容）。
 */
export function decryptString(payload: string): string {
  if (!payload) return payload;
  if (!payload.startsWith('v1:')) {
    // 旧明文数据 - 兼容（不应长期存在，提示一次）
    return payload;
  }
  const [, ivB64, encB64, tagB64] = payload.split(':');
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * 脱敏显示：前 6 + *** + 后 4
 */
export function maskSecret(secret: string, head = 6, tail = 4): string {
  if (!secret) return '';
  if (secret.length <= head + tail) return '*'.repeat(secret.length);
  return `${secret.slice(0, head)}***${secret.slice(-tail)}`;
}

/** 是否已加密 */
export function isEncrypted(s: string): boolean {
  return typeof s === 'string' && s.startsWith('v1:');
}
