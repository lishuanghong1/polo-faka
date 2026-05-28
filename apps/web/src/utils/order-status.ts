/**
 * 订单状态显示工具：统一本地订单（OrderStatus）+ 三方订单（ForgeOrderStatus）的展示。
 *
 * 设计原则：同一种业务含义 → 一致的中文文案、相同的颜色 token。
 * 调用方只关心「显示」，不关心订单来源。
 */

export type OrderStatusKey =
  | 'PENDING'
  | 'PAID'
  | 'DELIVERED'
  | 'FAILED'        // 仅 forge
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED';

export interface OrderStatusInfo {
  /** 中文文案，对用户展示 */
  text: string;
  /** Tailwind 文字+背景 class，用于 inline badge */
  cls: string;
  /** 仅边框样式（dashboard 用）*/
  borderCls: string;
  /** 是否为"完结"态（不需要轮询） */
  terminal: boolean;
}

const map: Record<OrderStatusKey, OrderStatusInfo> = {
  PENDING: {
    text: '待支付',
    cls: 'bg-amber-50 text-amber-700',
    borderCls: 'bg-amber-50 text-amber-700 border-amber-200',
    terminal: false,
  },
  PAID: {
    text: '已付款 · 发货中',
    cls: 'bg-sky-50 text-sky-700',
    borderCls: 'bg-sky-50 text-sky-700 border-sky-200',
    terminal: false,
  },
  DELIVERED: {
    text: '已发货',
    cls: 'bg-emerald-50 text-emerald-700',
    borderCls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    terminal: true,
  },
  FAILED: {
    text: '发货失败',
    cls: 'bg-rose-50 text-rose-700',
    borderCls: 'bg-rose-50 text-rose-700 border-rose-200',
    terminal: false, // 可重发，仍允许轮询
  },
  CANCELLED: {
    text: '已取消',
    cls: 'bg-ink-100 text-ink-500',
    borderCls: 'bg-ink-100 text-ink-500 border-ink-200',
    terminal: true,
  },
  EXPIRED: {
    text: '已超时',
    cls: 'bg-ink-100 text-ink-500',
    borderCls: 'bg-ink-100 text-ink-500 border-ink-200',
    terminal: true,
  },
  REFUNDED: {
    text: '已退款',
    cls: 'bg-rose-50 text-rose-700',
    borderCls: 'bg-rose-50 text-rose-700 border-rose-200',
    terminal: true,
  },
};

const fallback: OrderStatusInfo = {
  text: '未知',
  cls: 'bg-ink-100 text-ink-500',
  borderCls: 'bg-ink-100 text-ink-500 border-ink-200',
  terminal: true,
};

export function statusOf(s?: string | null): OrderStatusInfo {
  if (!s) return fallback;
  return map[s as OrderStatusKey] || { ...fallback, text: s };
}

/** 是否需要继续轮询（用于详情页 setInterval 判断） */
export function shouldKeepPolling(status?: string | null): boolean {
  if (!status) return false;
  const info = map[status as OrderStatusKey];
  return info ? !info.terminal : false;
}
