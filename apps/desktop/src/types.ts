/** Rust 端 ↔ 前端共享类型，命令返回值结构 */

export interface CursorInfo {
  installed: boolean;
  configDir: string | null;
  storageJsonPath: string | null;
  stateDbPath: string | null;
  machineIdFilePath: string | null;
  running: boolean;
  currentEmail: string | null;
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
  bonusSpendUsd: number | null;

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

  source: 'dashboard_rpc' | 'usage_summary' | 'auth_usage';
}
