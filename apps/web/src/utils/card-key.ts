export type ParsedDeliveryAccount = {
  email: string;
  token: string;
  raw: string;
};

export type DeliveryCardKeyItem = {
  content: string;
  isWarehouseDelivery?: boolean;
  remark?: string | null;
};

const WAREHOUSE_SEPARATOR = '----';
const WAREHOUSE_REMARK_PATTERN = /^from warehouse #\d+$/i;

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function looksLikeToken(value: string) {
  const v = value.trim();
  return v.length >= 20 || /^eyJ/i.test(v) || /^token[_-]/i.test(v);
}

export function parseDeliveryAccount(content: string): ParsedDeliveryAccount | null {
  const raw = String(content || '').trim();
  if (!raw) return null;

  try {
    const obj = JSON.parse(raw);
    const account = obj?.account_json || obj;
    const email = String(account?.email || obj?.email || '').trim();
    const token = String(
      account?.access_token || account?.token || obj?.access_token || obj?.token || '',
    ).trim();
    if (looksLikeEmail(email) && token) return { email, token, raw };
  } catch {
    // Plain card-key formats are handled below.
  }

  const parts = raw.split(WAREHOUSE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && looksLikeEmail(parts[0])) {
    const token = parts.length >= 4 ? parts[3] : parts[parts.length - 1];
    if (token && looksLikeToken(token)) {
      return { email: parts[0], token, raw };
    }
  }

  return null;
}

export function isWarehouseDeliveryItem(item: DeliveryCardKeyItem) {
  if (item.isWarehouseDelivery === true) return true;
  return WAREHOUSE_REMARK_PATTERN.test(String(item.remark || '').trim());
}

export function parseWarehouseDeliveryAccount(item: DeliveryCardKeyItem): ParsedDeliveryAccount | null {
  if (!isWarehouseDeliveryItem(item)) return null;
  return parseDeliveryAccount(item.content);
}

export function formatDeliveryAccountForCopy(account: ParsedDeliveryAccount) {
  return [`邮箱: ${account.email}`, `Token: ${account.token}`].join('\n');
}

/** Card-key display/copy: keep normal card keys as-is. */
export function formatCardKeyContent(content: string) {
  return content;
}

export function formatCardKeysForCopy(items: DeliveryCardKeyItem[]) {
  return items.map((item) => {
    const account = parseWarehouseDeliveryAccount(item);
    return account ? formatDeliveryAccountForCopy(account) : item.content;
  }).join('\n\n');
}
