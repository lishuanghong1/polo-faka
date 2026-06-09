use serde::Deserialize;
use tauri::State;

use crate::cursor::{token_parser, usage as usage_mod};
use crate::error::{AppError, AppResult};
use crate::store::accounts::{self, Account, NewAccount};
use crate::store::Store;

use super::account::{import_account_inner, ImportPayload, ImportResult};

#[tauri::command]
pub fn list_accounts(store: State<'_, Store>) -> AppResult<Vec<Account>> {
    store.with_conn(|c| accounts::list(c))
}

#[tauri::command]
pub fn delete_account(store: State<'_, Store>, id: i64) -> AppResult<()> {
    store.with_conn(|c| accounts::delete(c, id))
}

#[derive(Debug, Deserialize)]
pub struct UpdateLabelPayload {
    pub id: i64,
    pub label: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[tauri::command]
pub fn update_account_label(
    store: State<'_, Store>,
    payload: UpdateLabelPayload,
) -> AppResult<Account> {
    store.with_conn(|c| {
        accounts::update_label(
            c,
            payload.id,
            payload.label.as_deref(),
            payload.tags.as_deref(),
        )
    })
}

/// 从粘贴文本快速「只入库不切号」
#[tauri::command]
pub fn save_account_from_raw(store: State<'_, Store>, raw: String) -> AppResult<Account> {
    let parsed = token_parser::parse(&raw)?;
    let user_id = usage_mod::extract_user_id(&parsed.access_token);
    store.with_conn(|c| {
        accounts::upsert(
            c,
            NewAccount {
                email: parsed.email.as_deref(),
                access_token: &parsed.access_token,
                refresh_token: parsed.refresh_token.as_deref(),
                user_id: user_id.as_deref(),
                label: None,
            },
        )
    })
}

#[derive(Debug, Deserialize)]
pub struct SwitchOptions {
    #[serde(rename = "resetMachineId", default)]
    pub reset_machine_id: bool,
    #[serde(rename = "killAndRelaunch", default)]
    pub kill_and_relaunch: bool,
}

/// 用账号 ID 切号；复用 import_account 主流程；成功后更新 last_used_at。
#[tauri::command]
pub async fn switch_to_account(
    store: State<'_, Store>,
    id: i64,
    options: SwitchOptions,
) -> AppResult<ImportResult> {
    let account = store.with_conn(|c| accounts::get(c, id))?;
    // 用粘贴格式重组（用 email----token 让解析器走熟路径）
    let raw = match &account.email {
        Some(email) if !email.is_empty() => format!("{email}----{}", account.access_token),
        _ => account.access_token.clone(),
    };
    let result = import_account_inner(ImportPayload {
        raw,
        reset_machine_id: options.reset_machine_id,
        kill_and_relaunch: options.kill_and_relaunch,
    })
    .await?;
    // 标记最后使用
    if let Err(e) = store.with_conn(|c| accounts::mark_used(c, id)) {
        // 不阻塞主流程，但日志告警
        eprintln!("mark_used failed: {e}");
    }
    Ok(result)
}

/// 立即查询单个账号的用量，写回库
#[tauri::command]
pub async fn refresh_account_usage(
    store: State<'_, Store>,
    id: i64,
) -> AppResult<Account> {
    let account = store.with_conn(|c| accounts::get(c, id))?;
    let usage = usage_mod::query(&account.access_token).await?;
    store.with_conn(|c| accounts::save_usage(c, id, &usage))?;
    store.with_conn(|c| accounts::get(c, id))
}

/// 一次性刷新所有账号；返回每个账号的最新状态
#[tauri::command]
pub async fn refresh_all_accounts(store: State<'_, Store>) -> AppResult<Vec<Account>> {
    let list = store.with_conn(|c| accounts::list(c))?;
    for account in &list {
        // 失败不中断；下次定时刷新还会试
        if let Ok(usage) = usage_mod::query(&account.access_token).await {
            let _ = store.with_conn(|c| accounts::save_usage(c, account.id, &usage));
        }
    }
    store.with_conn(|c| accounts::list(c))
}

#[tauri::command]
pub fn db_path(_store: State<'_, Store>) -> AppResult<String> {
    let p = Store::db_path()?;
    p.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Other("路径包含非法字符".into()))
}
