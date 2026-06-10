import { invoke } from '@tauri-apps/api/core';
import type {
  Account,
  AppSettings,
  CaptchaInfo,
  CursorInfo,
  ImportPayload,
  ImportResult,
  NewIds,
  ParsedToken,
  PoolApplyResult,
  PoolGrantView,
  RecycleResult,
  ShopProfile,
  UsageInfo,
} from './types';

export const api = {
  detectCursor: () => invoke<CursorInfo>('detect_cursor'),
  parseToken: (raw: string) => invoke<ParsedToken>('parse_token', { raw }),
  importAccount: (payload: ImportPayload) =>
    invoke<ImportResult>('import_account', { payload }),
  resetMachineId: () => invoke<NewIds>('reset_machine_id'),
  killCursor: () => invoke<boolean>('kill_cursor'),
  launchCursor: () => invoke<boolean>('launch_cursor'),
  queryUsage: (token: string) => invoke<UsageInfo>('query_usage', { token }),
  queryUsageFromRaw: (raw: string) =>
    invoke<UsageInfo>('query_usage_from_raw', { raw }),
  queryCurrentUsage: () => invoke<UsageInfo>('query_current_usage'),

  // 账号库
  listAccounts: () => invoke<Account[]>('list_accounts'),
  deleteAccount: (id: number) => invoke<void>('delete_account', { id }),
  updateAccountLabel: (id: number, label: string | null, tags?: string[]) =>
    invoke<Account>('update_account_label', {
      payload: { id, label, tags },
    }),
  saveAccountFromRaw: (raw: string) =>
    invoke<Account>('save_account_from_raw', { raw }),
  switchToAccount: (
    id: number,
    options: { resetMachineId: boolean; killAndRelaunch: boolean },
  ) => invoke<ImportResult>('switch_to_account', { id, options }),
  refreshAccountUsage: (id: number) =>
    invoke<Account>('refresh_account_usage', { id }),
  refreshAllAccounts: () => invoke<Account[]>('refresh_all_accounts'),
  dbPath: () => invoke<string>('db_path'),

  // 设置
  getSettings: () => invoke<AppSettings>('get_settings'),
  saveSettings: (payload: AppSettings) =>
    invoke<AppSettings>('save_settings', { payload }),

  // 商城 / 号池联动
  shopGetCaptcha: () => invoke<CaptchaInfo>('shop_get_captcha'),
  shopLogin: (payload: {
    username: string;
    password: string;
    captchaId: string;
    captchaCode: string;
  }) => invoke<ShopProfile>('shop_login', { payload }),
  shopLogout: () => invoke<void>('shop_logout'),
  poolListMyGrants: () => invoke<PoolGrantView[]>('pool_list_my_grants'),
  poolClaim: (
    orderNo: string,
    options: {
      writeToCursor: boolean;
      resetMachineId: boolean;
      killAndRelaunch: boolean;
    },
  ) => invoke<PoolApplyResult>('pool_claim', { orderNo, options }),
  poolSwap: (
    orderNo: string,
    options: {
      writeToCursor: boolean;
      resetMachineId: boolean;
      killAndRelaunch: boolean;
    },
  ) => invoke<PoolApplyResult>('pool_swap', { orderNo, options }),
  poolRelease: (orderNo: string) =>
    invoke<PoolGrantView>('pool_release', { orderNo }),
  cursorLogout: (kill = true) =>
    invoke<boolean>('cursor_logout', { kill }),

  // 回收（向 Cursor 提交退款请求）
  recycleAccount: (email: string, invoiceNumber?: string) =>
    invoke<RecycleResult>('submit_recycle', {
      email,
      invoiceNumber: invoiceNumber?.trim() || null,
    }),
};
