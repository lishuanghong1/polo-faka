import { invoke } from '@tauri-apps/api/core';
import type {
  CursorInfo,
  ParsedToken,
  ImportPayload,
  ImportResult,
  NewIds,
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
};
