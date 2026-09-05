/**
 * 上游「Cursor 成品号购买 API」的数据形态（按对接文档整理）。
 * 金额一律「人民币分」。
 */

export interface UpstreamProduct {
  code: string;
  title: string;
  tier: string;
  priceCents: number;
  warrantyHours?: number | null;
  /** email / password / token / rawLine 子集；含 login = 授权登录发货；含 card = 池卡密发货 */
  deliveryFields?: string[];
  stock?: number;
  extractOnly?: boolean;
  ondemandTeam?: boolean;
  [key: string]: unknown;
}

/** kind=account 的成交单（qty>1 时 accounts 数组里的每一项也是这个形态） */
export interface UpstreamAccountSale {
  saleId: number;
  productCode: string;
  tier: string;
  warrantyUntil?: string | null;
  soldAt?: string | null;
  email?: string;
  password?: string;
  token?: string;
  rawLine?: string;
  /** 授权登录发货：没有 token，用户需在订单页提交 loginDeepControl 链接 */
  loginApprove?: boolean;
  /** 池卡密发货 */
  card?: string;
  cardNote?: string;
  /** 现做 Team 开通中：凭据为空，轮询 GET /orders/:id */
  making?: boolean;
  [key: string]: unknown;
}

export interface UpstreamExtractCard {
  id: number;
  code: string;
  masked: string;
  totalCredits: number;
  remainingCredits: number;
  [key: string]: unknown;
}

export type UpstreamBuyResult =
  | ({ kind: 'account' } & UpstreamAccountSale)
  | {
      kind: 'accounts';
      requested?: number;
      bought?: number;
      accounts?: UpstreamAccountSale[];
      deliveries?: UpstreamAccountSale[];
      items?: UpstreamAccountSale[];
      [key: string]: unknown;
    }
  | {
      kind: 'extract';
      requested: number;
      bought: number;
      deliveries: unknown[];
      extractCards: UpstreamExtractCard[];
      [key: string]: unknown;
    }
  /** 旧版 / 未带 kind 的直发响应，字段与 account 兼容 */
  | (UpstreamAccountSale & { kind?: undefined });

export interface UpstreamOrderSummary {
  saleId?: number;
  id?: number;
  productCode?: string;
  tier?: string;
  soldAt?: string;
  warrantyUntil?: string;
  [key: string]: unknown;
}

/** 从上游成交结果里抽出账号数组（兼容 account / accounts / 无 kind 三种形态） */
export function extractAccountSales(data: UpstreamBuyResult): UpstreamAccountSale[] {
  const anyData = data as Record<string, unknown>;
  if (anyData.kind === 'accounts') {
    const list = anyData.accounts ?? anyData.deliveries ?? anyData.items;
    return Array.isArray(list) ? (list as UpstreamAccountSale[]) : [];
  }
  if (anyData.kind === 'extract') return [];
  if (typeof anyData.saleId === 'number') return [data as UpstreamAccountSale];
  return [];
}

/** 判断某个成交单的交付形态 */
export function classifySale(sale: UpstreamAccountSale): 'account' | 'login' | 'card' {
  if (sale.loginApprove) return 'login';
  if (typeof sale.card === 'string' && sale.card) return 'card';
  return 'account';
}

/** 结构化凭据：只保留有值的字段 */
export function pickCredentials(sale: UpstreamAccountSale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['email', 'password', 'token', 'rawLine', 'card', 'cardNote'] as const) {
    const v = sale[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** 卡密表 content：优先上游 rawLine；否则 email----password----token 拼接 */
export function buildCardContent(kind: 'account' | 'login' | 'card', sale: UpstreamAccountSale): string {
  const c = pickCredentials(sale);
  if (kind === 'card') return c.cardNote ? `${c.card}  # ${c.cardNote}` : c.card;
  if (kind === 'login') return c.email || `saleId=${sale.saleId}`;
  if (c.rawLine) return c.rawLine;
  const parts = [c.email, c.password, c.token].filter(Boolean);
  return parts.length ? parts.join('----') : `saleId=${sale.saleId}`;
}
