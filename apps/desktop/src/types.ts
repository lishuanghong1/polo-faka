/** Rust 端 ↔ 前端共享类型，命令返回值结构 */

export interface CursorInfo {
  installed: boolean;
  configDir: string | null;
  storageJsonPath: string | null;
  stateDbPath: string | null;
  machineIdFilePath: string | null;
  running: boolean;
  currentEmail: string | null;
  /** auth0|user_xxx 已规范为 user_xxx */
  currentUserId: string | null;
  currentDeviceId: string | null;
}

export interface ParsedToken {
  email: string | null;
  emailPassword: string | null;
  cursorPassword: string | null;
  accessToken: string;
  refreshToken: string | null;
  /** 'WorkosCursorSessionToken' 这种带前缀的会被剥掉 */
  rawSource: string;
}

export interface ImportPayload {
  raw: string;
  resetMachineId: boolean;
  killAndRelaunch: boolean;
}

export interface ImportResult {
  email: string | null;
  accountId: number | null;
  backupDir: string;
  resetMachineId: boolean;
  relaunched: boolean;
  newDeviceId: string | null;
}

export interface NewIds {
  devDeviceId: string;
  machineId: string;
  macMachineId: string;
  sqmId: string;
  backupDir: string;
}

/** Cursor 当前周期的用量信息（来自反向工程的 dashboard 接口，所有字段都可能缺失） */
export interface UsageInfo {
  /** Pro / Pro+ / Business / Free Trial 等 */
  plan: string | null;
  userId: string | null;

  // 金额（美元）
  totalSpendUsd: number | null;
  includedSpendUsd: number | null;
  limitUsd: number | null;
  remainingUsd: number | null;
  /** 赠送池总量 */
  bonusQuotaUsd: number | null;
  /** 赠送池已消耗 */
  bonusUsedUsd: number | null;
  /** @deprecated 等同 bonusUsedUsd */
  bonusSpendUsd: number | null;
  /** API 高级模型花费 */
  apiSpendUsd: number | null;
  /** 超额 / 按需花费 */
  overageSpendUsd: number | null;

  // 百分比（0~100）
  autoPercent: number | null;
  apiPercent: number | null;
  totalPercent: number | null;

  // 按需付费上限
  individualLimitUsd: number | null;
  individualUsedUsd: number | null;

  periodStart: string | null;
  periodEnd: string | null;

  // Enterprise 风格的请求数
  requestsUsed: number | null;
  requestsLimit: number | null;

  source: 'dashboard_rpc' | 'usage_summary' | 'usage_events' | 'auth_usage';
}

/** 账号库里的一条记录（缓存了上次查到的用量） */
export interface Account {
  id: number;
  email: string | null;
  accessToken: string;
  refreshToken: string | null;
  userId: string | null;
  label: string | null;
  tags: string[];

  plan: string | null;
  totalSpendUsd: number | null;
  includedSpendUsd: number | null;
  limitUsd: number | null;
  remainingUsd: number | null;
  totalPercent: number | null;
  autoPercent: number | null;
  apiPercent: number | null;
  bonusQuotaUsd: number | null;
  bonusUsedUsd: number | null;
  individualLimitUsd: number | null;
  individualUsedUsd: number | null;
  apiSpendUsd: number | null;
  overageSpendUsd: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  usageSource: string | null;
  lastUsageAt: number | null;

  createdAt: number;
  lastUsedAt: number | null;

  // 号池绑定
  poolGrantOrderNo: string | null;
  poolQuotaTotal: number | null;
  poolQuotaUsed: number | null;
  poolQuotaRemain: number | null;
  poolGrantActive: boolean | null;
}

export interface AppSettings {
  autoRefreshSeconds: number;
  quotaAlertEnabled: boolean;
  warnPercent: number;
  criticalPercent: number;
  defaultResetMachineId: boolean;
  defaultRelaunch: boolean;

  // 商城 & 号池
  shopBaseUrl: string;
  shopJwt: string | null;
  shopUsername: string | null;
  poolAutoEnabled: boolean;
  poolSwapThresholdPercent: number;
  poolClearCursorOnExhausted: boolean;
}

// ─────── 号池数据结构 ───────
export interface PoolAccountView {
  id: number;
  email: string | null;
  token: string | null;
  tokenMasked?: string | null;
}

export interface PoolGrantView {
  id: number | null;
  orderNo: string;
  orderTitle?: string | null;
  quotaTotal: number;
  quotaUsed: number;
  quotaRemain: number;
  active: boolean;
  endAt?: string | null;
  lastCheckAt?: string | null;
  account: PoolAccountView | null;
  notProvisioned?: boolean;
}

export interface PoolApplyResult {
  grant: PoolGrantView;
  wroteToCursor: boolean;
  accountId: number | null;
}

export interface CaptchaInfo {
  id: string;
  svg: string;
  expiresIn: number;
}

/** 「回收」提交退款请求的返回 */
export interface RecycleResult {
  email: string | null;
  invoiceNumber: string | null;
  purchaseDate: string | null;
  /** 实际发送给 Cursor 的正文 */
  message: string;
  /** classify 接口返回的原始 JSON */
  response: unknown;
}

export interface ShopProfile {
  username: string | null;
  email: string | null;
  nickname: string | null;
}

/** 后台 refresh 任务推送的事件 */
export interface UsageUpdateEvent {
  id: number;
  email: string | null;
  totalPercent: number | null;
  remainingUsd: number | null;
}

export interface QuotaAlertEvent {
  id: number;
  email: string | null;
  plan: string | null;
  percent: number;
  level: 'warn' | 'critical';
}

export interface DeepLinkImportEvent {
  email: string | null;
  token: string | null;
  raw: string;
  action: string;
}

export interface PoolSwappedEvent {
  oldAccountId: number;
  newEmail: string | null;
  orderNo: string;
}

export interface PoolExhaustedEvent {
  accountId: number;
  orderNo: string;
  email: string | null;
  clearedCursor: boolean;
}
