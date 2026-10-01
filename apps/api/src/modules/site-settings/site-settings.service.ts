import { BadRequestException, Injectable, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AlipayService } from '../alipay/alipay.service';
import { encryptString, decryptString, isEncrypted } from '../../common/crypto.util';

/**
 * 这些 key 的 value 入库前会被 AES-GCM 加密；
 * getAll() 不返回原文（只用占位符 + hasValue 标志）。
 * 业务消费方使用 readSecret() 拿明文。
 */
const SECRET_KEYS = new Set<string>([
  'alipay_private_key',
  'alipay_public_key',
  'cursor_refund_owner_token',
]);

/** 历史渠道配置只保留在数据库中，禁止读取、公开和重新启用。 */
function isRemovedChannelKey(key: string) {
  return ['forge_', 'email_code_', 'aizhp_', 'cursor_sell_'].some((prefix) => key.startsWith(prefix));
}

function assertActiveSetting(key: string) {
  if (isRemovedChannelKey(key)) {
    throw new BadRequestException('该渠道已移除，不能修改其配置');
  }
}

/** 已设置的占位符：编辑表单显示此字符串，提交回来时表示"保持不变" */
const SECRET_PLACEHOLDER = '__keep__';
/** 密钥字段留空即"保持不变"，所以清除需要显式哨兵值 */
const SECRET_CLEAR = '__clear__';

@Injectable()
export class SiteSettingsService {
  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(forwardRef(() => AlipayService)) private alipay?: AlipayService,
  ) {}

  async getPublic() {
    const rows = await this.prisma.siteSetting.findMany({ where: { isPublic: true } });
    const obj: Record<string, string> = {};
    for (const r of rows) {
      // 公开接口不能下发任何 SECRET（即便设错了 isPublic 也得拦住）
      if (SECRET_KEYS.has(r.key) || isRemovedChannelKey(r.key)) continue;
      obj[r.key] = r.value;
    }
    return obj;
  }

  /**
   * 管理后台用：敏感 key 用占位符隐藏原值。
   * 前端编辑时如果不修改就原样回传占位符；后端识别后跳过。
   */
  async getAll() {
    const rows = await this.prisma.siteSetting.findMany();
    return rows.filter((r) => !isRemovedChannelKey(r.key)).map((r) => {
      if (SECRET_KEYS.has(r.key)) {
        const has = !!r.value;
        return {
          ...r,
          value: has ? SECRET_PLACEHOLDER : '',
          hasValue: has,
          isSecret: true,
        };
      }
      return { ...r, hasValue: !!r.value, isSecret: false };
    });
  }

  /**
   * 业务方读取一个设置项的明文值；自动解密。
   */
  async readSecret(key: string): Promise<string> {
    assertActiveSetting(key);
    const row = await this.prisma.siteSetting.findUnique({ where: { key } });
    if (!row?.value) return '';
    if (SECRET_KEYS.has(key) && isEncrypted(row.value)) {
      try {
        return decryptString(row.value);
      } catch {
        return '';
      }
    }
    return row.value;
  }

  async set(key: string, value: string, isPublic = false) {
    assertActiveSetting(key);
    let storeValue = value;
    if (SECRET_KEYS.has(key) && value) {
      // SECRET 永远以加密形式入库；公开标记一律强制为 false
      storeValue = encryptString(value);
      isPublic = false;
    }
    return this.prisma.siteSetting.upsert({
      where: { key },
      update: { value: storeValue, isPublic },
      create: { key, value: storeValue, isPublic },
    });
  }

  async setMany(map: Record<string, { value: string; isPublic?: boolean }>) {
    // 先校验整批，避免新旧配置混合提交造成部分写入。
    Object.keys(map).forEach(assertActiveSetting);
    const ops: any[] = [];
    for (const [k, v] of Object.entries(map)) {
      const isSecret = SECRET_KEYS.has(k);
      // 占位符 / 空字符串：保持原值
      if (isSecret && (v.value === SECRET_PLACEHOLDER || v.value === '')) {
        continue;
      }
      let storeValue = v.value;
      let isPublic = !!v.isPublic;
      if (isSecret) {
        storeValue = v.value === SECRET_CLEAR ? '' : encryptString(v.value);
        isPublic = false;
      }
      ops.push(
        this.prisma.siteSetting.upsert({
          where: { key: k },
          update: { value: storeValue, isPublic },
          create: { key: k, value: storeValue, isPublic },
        }),
      );
    }
    if (ops.length) await this.prisma.$transaction(ops);
    const keys = Object.keys(map);
    if (keys.some((k) => k.startsWith('alipay_'))) {
      this.alipay?.invalidate();
    }
    return { updated: ops.length };
  }
}
