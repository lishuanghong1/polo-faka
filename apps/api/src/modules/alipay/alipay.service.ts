import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AlipaySdk } from 'alipay-sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptString, isEncrypted } from '../../common/crypto.util';

const SETTING_KEYS = [
  'alipay_enabled',
  'alipay_app_id',
  'alipay_private_key',
  'alipay_public_key',
  'alipay_sandbox',
  'alipay_sign_type',
  'alipay_notify_base',
  'alipay_seller_id',
];

interface AlipayConfigSnapshot {
  enabled: boolean;
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  sandbox: boolean;
  signType: 'RSA2' | 'RSA';
  notifyBase: string;
  sellerId?: string;
}

@Injectable()
export class AlipayService {
  private readonly logger = new Logger(AlipayService.name);
  private sdk: AlipaySdk | null = null;
  private snapshot: AlipayConfigSnapshot | null = null;

  constructor(private prisma: PrismaService) {}

  /** 从环境变量或数据库读取配置（环境变量优先） */
  private async loadConfig(): Promise<AlipayConfigSnapshot | null> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) {
      let v = r.value;
      // 敏感字段：库内是 v1:... 密文 → 解密
      if (
        (r.key === 'alipay_private_key' || r.key === 'alipay_public_key') &&
        isEncrypted(v)
      ) {
        try {
          v = decryptString(v);
        } catch (e) {
          this.logger.error(`decrypt ${r.key} failed: ${(e as Error).message}`);
          v = '';
        }
      }
      map[r.key] = v;
    }

    const enabled =
      (process.env.ALIPAY_ENABLED ?? map.alipay_enabled ?? '') === 'true';
    if (!enabled) return null;

    const appId = (process.env.ALIPAY_APP_ID ?? map.alipay_app_id ?? '').trim();
    const privateKey = (process.env.ALIPAY_PRIVATE_KEY ?? map.alipay_private_key ?? '').trim();
    const alipayPublicKey = (process.env.ALIPAY_PUBLIC_KEY ?? map.alipay_public_key ?? '').trim();
    const sandbox =
      (process.env.ALIPAY_SANDBOX ?? map.alipay_sandbox ?? 'true') === 'true';
    const signType =
      ((process.env.ALIPAY_SIGN_TYPE ?? map.alipay_sign_type ?? 'RSA2') as 'RSA2' | 'RSA') || 'RSA2';
    const notifyBase = (process.env.ALIPAY_NOTIFY_BASE ?? map.alipay_notify_base ?? '').trim();
    const sellerId = (process.env.ALIPAY_SELLER_ID ?? map.alipay_seller_id ?? '').trim() || undefined;

    if (!appId || !privateKey || !alipayPublicKey) {
      this.logger.warn('Alipay enabled but missing required fields');
      return null;
    }
    return { enabled, appId, privateKey, alipayPublicKey, sandbox, signType, notifyBase, sellerId };
  }

  /** 拿到（或重建）SDK 实例 */
  private async getSdk(): Promise<{ sdk: AlipaySdk; cfg: AlipayConfigSnapshot } | null> {
    const cfg = await this.loadConfig();
    if (!cfg) {
      this.sdk = null;
      this.snapshot = null;
      return null;
    }
    if (!this.sdk || !this.snapshot || JSON.stringify(this.snapshot) !== JSON.stringify(cfg)) {
      this.sdk = new AlipaySdk({
        appId: cfg.appId,
        privateKey: cfg.privateKey,
        alipayPublicKey: cfg.alipayPublicKey,
        signType: cfg.signType,
        gateway: cfg.sandbox
          ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
          : 'https://openapi.alipay.com/gateway.do',
      });
      this.snapshot = cfg;
      this.logger.log(`Alipay SDK initialized (sandbox=${cfg.sandbox}, appId=${cfg.appId})`);
    }
    return { sdk: this.sdk, cfg };
  }

  /** 强制重新加载（设置页保存后调用） */
  invalidate() {
    this.sdk = null;
    this.snapshot = null;
  }

  async isEnabled() {
    const r = await this.getSdk();
    return !!r;
  }

  /**
   * 创建支付链接
   * @param channel PC | WAP
   */
  async createPayUrl(params: {
    orderNo: string;
    amount: number;
    subject: string;
    channel: 'PC' | 'WAP';
    returnUrl?: string;
  }): Promise<string> {
    const r = await this.getSdk();
    if (!r) throw new BadRequestException('支付宝支付未启用或配置不完整');
    const { sdk, cfg } = r;
    if (!cfg.notifyBase) {
      throw new BadRequestException('未配置 alipay_notify_base（公网回调地址）');
    }

    const method = params.channel === 'WAP' ? 'alipay.trade.wap.pay' : 'alipay.trade.page.pay';
    const productCode = params.channel === 'WAP' ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY';

    const url = sdk.pageExecute(method, 'GET', {
      bizContent: {
        out_trade_no: params.orderNo,
        product_code: productCode,
        total_amount: params.amount.toFixed(2),
        subject: params.subject.slice(0, 128),
      },
      returnUrl: params.returnUrl || `${cfg.notifyBase}/api/pay/alipay/return`,
      notifyUrl: `${cfg.notifyBase}/api/pay/alipay/notify`,
    } as any);

    return url;
  }

  /** 异步通知验签 */
  async verifyNotify(postData: Record<string, any>): Promise<boolean> {
    const r = await this.getSdk();
    if (!r) return false;
    try {
      return r.sdk.checkNotifySignV2(postData);
    } catch (e) {
      this.logger.error(`verifyNotify failed: ${(e as Error).message}`);
      return false;
    }
  }
}
