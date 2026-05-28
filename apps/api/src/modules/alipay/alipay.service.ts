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
  signType: 'RSA2'; // 强制 RSA2，支付宝已不再支持 RSA1
  notifyBase: string;
  sellerId?: string;
}

/** 移除控制字符 / 多余空白，避免 subject 让支付宝拒收或在账单里乱码 */
function sanitizeSubject(s: string, maxLen = 128): string {
  return (s || '')
    .replace(/[\x00-\x1F\x7F]/g, '') // 控制字符
    .replace(/\s+/g, ' ') // 折叠空白
    .trim()
    .slice(0, maxLen);
}

@Injectable()
export class AlipayService {
  private readonly logger = new Logger(AlipayService.name);
  private sdk: AlipaySdk | null = null;
  private snapshot: AlipayConfigSnapshot | null = null;
  private snapshotKey = '';

  constructor(private prisma: PrismaService) {}

  /** 从环境变量或数据库读取配置（环境变量优先，空字符串视为未配置） */
  private async loadConfig(): Promise<AlipayConfigSnapshot | null> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) {
      let v = r.value;
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

    const pick = (envVal: string | undefined, dbVal: string | undefined): string => {
      const e = (envVal ?? '').trim();
      if (e) return e;
      return (dbVal ?? '').trim();
    };

    const enabledRaw = pick(process.env.ALIPAY_ENABLED, map.alipay_enabled);
    const enabled = enabledRaw === 'true' || enabledRaw === '1';
    if (!enabled) return null;

    const appId = pick(process.env.ALIPAY_APP_ID, map.alipay_app_id);
    const privateKey = pick(process.env.ALIPAY_PRIVATE_KEY, map.alipay_private_key);
    const alipayPublicKey = pick(process.env.ALIPAY_PUBLIC_KEY, map.alipay_public_key);
    const sandboxRaw = pick(process.env.ALIPAY_SANDBOX, map.alipay_sandbox) || 'true';
    const sandbox = sandboxRaw === 'true' || sandboxRaw === '1';
    // 支付宝已不再支持 RSA1，强制 RSA2，避免 admin 配错
    const signType: 'RSA2' = 'RSA2';
    const notifyBase = (
      pick(process.env.ALIPAY_NOTIFY_BASE_URL, undefined) ||
      pick(process.env.ALIPAY_NOTIFY_BASE, map.alipay_notify_base)
    ).replace(/\/+$/, '');
    const sellerId = pick(process.env.ALIPAY_SELLER_ID, map.alipay_seller_id) || undefined;

    if (!appId || !privateKey || !alipayPublicKey) {
      this.logger.warn('Alipay enabled but missing required fields');
      return null;
    }
    return { enabled, appId, privateKey, alipayPublicKey, sandbox, signType, notifyBase, sellerId };
  }

  /** 拿到（或重建）SDK 实例；用字段 hash 避免 JSON.stringify 每次重比 */
  private async getSdk(): Promise<{ sdk: AlipaySdk; cfg: AlipayConfigSnapshot } | null> {
    const cfg = await this.loadConfig();
    if (!cfg) {
      this.sdk = null;
      this.snapshot = null;
      this.snapshotKey = '';
      return null;
    }
    const key = `${cfg.appId}|${cfg.sandbox}|${cfg.signType}|${cfg.privateKey.length}|${cfg.alipayPublicKey.length}|${cfg.notifyBase}|${cfg.sellerId ?? ''}`;
    if (!this.sdk || this.snapshotKey !== key) {
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
      this.snapshotKey = key;
      this.logger.log(
        `Alipay SDK initialized (sandbox=${cfg.sandbox}, appId=${cfg.appId}, sellerIdChecked=${!!cfg.sellerId})`,
      );
    }
    return { sdk: this.sdk, cfg };
  }

  /** 强制重新加载（设置页保存后调用） */
  invalidate() {
    this.sdk = null;
    this.snapshot = null;
    this.snapshotKey = '';
  }

  async isEnabled() {
    const r = await this.getSdk();
    return !!r;
  }

  async getSellerId(): Promise<string | undefined> {
    const r = await this.getSdk();
    return r?.cfg.sellerId;
  }

  /**
   * 创建支付链接
   * - 显式 timeout_express=15m（与本地订单过期一致）
   * - subject 过滤控制字符
   * - body 携带 数量 / 单价 便于对账
   */
  async createPayUrl(params: {
    orderNo: string;
    amount: number;
    subject: string;
    body?: string;
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

    const bizContent: Record<string, any> = {
      out_trade_no: params.orderNo,
      product_code: productCode,
      total_amount: params.amount.toFixed(2),
      subject: sanitizeSubject(params.subject, 128),
      timeout_express: '15m',
    };
    if (params.body) {
      bizContent.body = sanitizeSubject(params.body, 128);
    }

    const url = sdk.pageExecute(method, 'GET', {
      bizContent,
      returnUrl: params.returnUrl || `${cfg.notifyBase}/api/pay/alipay/return`,
      notifyUrl: `${cfg.notifyBase}/api/pay/alipay/notify`,
    } as any);

    return url;
  }

  /**
   * 异步通知验签 + seller_id 强校验。
   * - 验签：证明是支付宝服务器发的
   * - seller_id 校验：证明钱进了「我们的」商户号，防伪造 notify
   */
  async verifyNotify(postData: Record<string, any>): Promise<boolean> {
    const r = await this.getSdk();
    if (!r) return false;
    try {
      const ok = r.sdk.checkNotifySignV2(postData);
      if (!ok) return false;

      // seller_id 强校验。
      // - 本地配了 sellerId：notify 必须带 seller_id 且必须一致；任一不满足都视为伪造
      // - 本地未配：每次打 warn 提醒运维去 settings 里补上（强烈建议配置）
      if (r.cfg.sellerId) {
        const fromNotify = postData?.seller_id ? String(postData.seller_id).trim() : '';
        if (!fromNotify) {
          this.logger.error(
            `alipay notify missing seller_id while local sellerId is configured (out_trade_no=${postData?.out_trade_no})`,
          );
          return false;
        }
        if (fromNotify !== r.cfg.sellerId.trim()) {
          this.logger.error(
            `alipay notify seller_id mismatch: got=${fromNotify} expected=${r.cfg.sellerId}`,
          );
          return false;
        }
      } else {
        // 未配置 sellerId 时打 warn，但每个 notify 都打太吵；用纳秒级节流：5 分钟一次
        const now = Date.now();
        if (!this.lastSellerIdWarn || now - this.lastSellerIdWarn > 5 * 60_000) {
          this.lastSellerIdWarn = now;
          this.logger.warn(
            'alipay notify accepted WITHOUT seller_id check. Please configure alipay_seller_id in admin settings to harden against fake notifies.',
          );
        }
      }
      // app_id 同源校验（防多商户串号）
      if (postData?.app_id && String(postData.app_id).trim() !== r.cfg.appId.trim()) {
        this.logger.error(
          `alipay notify app_id mismatch: got=${postData.app_id} expected=${r.cfg.appId}`,
        );
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(`verifyNotify failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** 用于 seller_id 未配置时的 warn 日志节流，单进程足够 */
  private lastSellerIdWarn = 0;

  /**
   * 主动查询订单状态（用于 notify 丢失兜底）。
   * 返回值：
   *   { tradeStatus: 'TRADE_SUCCESS'|'WAIT_BUYER_PAY'|'TRADE_CLOSED'|null, tradeNo, totalAmount, buyerLogonId }
   *   未支付/不存在 → tradeStatus = null
   */
  async tradeQuery(orderNo: string): Promise<{
    tradeStatus: string | null;
    tradeNo?: string;
    totalAmount?: number;
    buyerLogonId?: string;
  }> {
    const r = await this.getSdk();
    if (!r) throw new BadRequestException('支付宝未启用');
    try {
      const res: any = await r.sdk.exec('alipay.trade.query', {
        bizContent: { out_trade_no: orderNo },
      });
      // 接口本身 OK 才看交易状态；ACQ.TRADE_NOT_EXIST 表示订单还没创建/不存在
      if (res?.code && res.code !== '10000') {
        if (res.subCode === 'ACQ.TRADE_NOT_EXIST') {
          return { tradeStatus: null };
        }
        throw new Error(`${res.code}/${res.subCode}: ${res.subMsg || res.msg}`);
      }
      return {
        tradeStatus: res?.tradeStatus || null,
        tradeNo: res?.tradeNo,
        totalAmount: res?.totalAmount ? Number(res.totalAmount) : undefined,
        buyerLogonId: res?.buyerLogonId || res?.buyerUserId,
      };
    } catch (e) {
      this.logger.warn(`tradeQuery ${orderNo}: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * 关闭未支付订单。支付宝侧标记为"已关闭"，防止用户拿旧链接付款后悬挂资金。
   * - 已支付的订单调用此接口会失败（ACQ.TRADE_STATUS_ERROR），可忽略
   * - 订单不存在也算成功（不需要关）
   */
  async tradeClose(orderNo: string): Promise<{ ok: boolean; reason?: string }> {
    const r = await this.getSdk();
    if (!r) return { ok: false, reason: '支付宝未启用' };
    try {
      const res: any = await r.sdk.exec('alipay.trade.close', {
        bizContent: { out_trade_no: orderNo },
      });
      if (res?.code === '10000') return { ok: true };
      // 这些子码表示无需操作
      if (
        res?.subCode === 'ACQ.TRADE_NOT_EXIST' ||
        res?.subCode === 'ACQ.TRADE_HAS_CLOSE' ||
        res?.subCode === 'ACQ.TRADE_STATUS_ERROR'
      ) {
        return { ok: true, reason: res.subCode };
      }
      return { ok: false, reason: `${res?.code}/${res?.subCode}: ${res?.subMsg || res?.msg}` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  /**
   * 原路退款。
   * - 部分退款也可，但目前只暴露全额退款
   * - refundReason 必填，便于对账
   * - 幂等：用 outRequestNo（首退用 orderNo，二退用 orderNo-2 等），避免重复发起
   */
  async tradeRefund(params: {
    orderNo: string;
    refundAmount: number;
    refundReason: string;
    outRequestNo?: string;
  }): Promise<{ ok: boolean; refundFee?: number; reason?: string }> {
    const r = await this.getSdk();
    if (!r) return { ok: false, reason: '支付宝未启用' };
    if (!params.refundReason?.trim()) {
      return { ok: false, reason: '退款原因必填' };
    }
    if (!(params.refundAmount > 0)) {
      return { ok: false, reason: '退款金额必须 > 0' };
    }
    try {
      const res: any = await r.sdk.exec('alipay.trade.refund', {
        bizContent: {
          out_trade_no: params.orderNo,
          refund_amount: params.refundAmount.toFixed(2),
          refund_reason: params.refundReason.slice(0, 256),
          out_request_no: params.outRequestNo || params.orderNo,
        },
      });
      if (res?.code === '10000' && res?.fundChange === 'Y') {
        return { ok: true, refundFee: Number(res.refundFee || params.refundAmount) };
      }
      // fundChange = 'N' 但 code = '10000' 表示已退过，幂等成功
      if (res?.code === '10000' && res?.fundChange === 'N') {
        return { ok: true, refundFee: 0, reason: '已退款（幂等命中）' };
      }
      return { ok: false, reason: `${res?.code}/${res?.subCode}: ${res?.subMsg || res?.msg}` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }
}
