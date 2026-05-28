/**
 * 统一的格式化工具
 * 不要直接在模板里写 `new Date(x).toLocaleString()` / `Number(x).toFixed(2)`
 */

const MONEY_FMT = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 金额：传 number 或 string，输出 "¥1,234.50" */
export function formatMoney(v: number | string | null | undefined, withSymbol = true): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return withSymbol ? '¥0.00' : '0.00';
  const s = MONEY_FMT.format(n);
  return withSymbol ? `¥${s}` : s;
}

/** 金额（不带符号 + 不带千位分隔），适合 input 回填 */
export function formatMoneyRaw(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

const DATETIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "2026-05-28 11:34" 风格 */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '-';
  return DATETIME_FMT.format(d).replace(/\//g, '-');
}

/** 仅日期 */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '-';
  return DATE_FMT.format(d).replace(/\//g, '-');
}

/** 仅时间 */
export function formatTime(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '-';
  return TIME_FMT.format(d);
}

/**
 * 相对时间："3 分钟前" / "昨天 14:23" / "2026-05-20"
 * - 1 分钟以内：刚刚
 * - 1 小时以内：N 分钟前
 * - 24 小时以内：N 小时前
 * - 2 天以内：昨天 HH:mm
 * - 7 天以内：N 天前
 * - 更早：完整日期
 */
export function formatRelative(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '-';
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 2) return `昨天 ${TIME_FMT.format(d)}`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`;
  return formatDate(d);
}

/** 截断长字符串，中间用 … 占位（适合订单号/邮箱） */
export function ellipsisMid(s: string | null | undefined, head = 6, tail = 6): string {
  if (!s) return '';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** 复制到剪贴板，失败回退到 textarea + execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ignore, fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
