import { invoke } from '@tauri-apps/api/core';
import type {
  Account,
  AppSettings,
  CursorInfo,
  ImportPayload,
  ImportResult,
  NewIds,
  ParsedToken,
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
};
