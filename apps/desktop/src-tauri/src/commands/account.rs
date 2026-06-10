use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::cursor::{
    machine_id::{apply as apply_machine_ids, NewMachineIds},
    paths::CursorPaths,
    process,
    state_vscdb, storage_json,
    token_parser::{self, ParsedToken},
    usage as usage_mod,
};
use crate::error::{AppError, AppResult};
use crate::store::accounts::{self, NewAccount};
use crate::store::Store;

#[derive(Debug, Deserialize)]
pub struct ImportPayload {
    pub raw: String,
    #[serde(rename = "resetMachineId", default)]
    pub reset_machine_id: bool,
    #[serde(rename = "killAndRelaunch", default)]
    pub kill_and_relaunch: bool,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub email: Option<String>,
    #[serde(rename = "accountId")]
    pub account_id: Option<i64>,
    #[serde(rename = "backupDir")]
    pub backup_dir: String,
    #[serde(rename = "resetMachineId")]
    pub reset_machine_id: bool,
    pub relaunched: bool,
    #[serde(rename = "newDeviceId")]
    pub new_device_id: Option<String>,
}

impl ImportResult {
    fn new(parsed_email: Option<String>, backup_dir: String, reset_machine_id: bool, relaunched: bool, new_device_id: Option<String>) -> Self {
        Self {
            email: parsed_email,
            account_id: None,
            backup_dir,
            reset_machine_id,
            relaunched,
            new_device_id,
        }
    }
}

#[tauri::command]
pub fn parse_token(raw: String) -> AppResult<ParsedToken> {
    token_parser::parse(&raw)
}

/// 端到端：粘贴内容 → 解析 → 关 Cursor → 备份 → 写 state.vscdb + storage.json
/// （可选）重置机器码 → （可选）重启 Cursor → 写入本机账号库
#[tauri::command]
pub async fn import_account(
    store: State<'_, Store>,
    payload: ImportPayload,
) -> AppResult<ImportResult> {
    // 先单独解析一次拿原始 token；inner 函数自己也会解析，但解析很快、无副作用
    let parsed = token_parser::parse(&payload.raw)?;
    let mut result = import_account_inner(payload).await?;

    let user_id = usage_mod::extract_user_id(&parsed.access_token);
    let upserted = store.with_conn(|c| {
        accounts::upsert(
            c,
            NewAccount {
                email: parsed.email.as_deref(),
                access_token: &parsed.access_token,
                refresh_token: parsed.refresh_token.as_deref(),
                user_id: user_id.as_deref(),
                label: None,
                pool_grant_order_no: None,
            },
        )
    });
    if let Ok(account) = upserted {
        let _ = store.with_conn(|c| accounts::mark_used(c, account.id));
        result.account_id = Some(account.id);
    }
    Ok(result)
}

/// 不依赖 Tauri State 的核心实现，便于被 switch_to_account 等内部命令直接调用。
/// 主流程：解析 → 关 Cursor → 备份 → 写双存储 → 可选重置机器码 → 可选重启。
pub async fn import_account_inner(payload: ImportPayload) -> AppResult<ImportResult> {
    let parsed = token_parser::parse(&payload.raw)?;

    let paths = CursorPaths::detect()?;
    if !paths.is_installed() {
        return Err(AppError::CursorNotFound);
    }

    if process::is_running() {
        process::kill_all()?;
    }
    process::wait_for_db_writable(&paths.state_db)?;

    let backup_dir = CursorPaths::new_backup_dir()?;
    storage_json::backup(&paths.storage_json, &backup_dir)?;
    let _ = state_vscdb::backup(&paths.state_db, &backup_dir)?;

    write_account_to_state_db(&paths.state_db, &parsed)?;
    write_account_to_storage_json(&paths.storage_json, &parsed)?;

    let new_device_id = if payload.reset_machine_id {
        let ids = NewMachineIds::generate();
        apply_machine_ids(&paths, &ids)?;
        Some(ids.dev_device_id)
    } else {
        None
    };

    let relaunched = if payload.kill_and_relaunch {
        process::launch()?
    } else {
        false
    };

    Ok(ImportResult::new(
        parsed.email,
        backup_dir.to_string_lossy().into_owned(),
        payload.reset_machine_id,
        relaunched,
        new_device_id,
    ))
}

fn resolve_write_email(parsed: &ParsedToken) -> String {
    parsed
        .email
        .clone()
        .or_else(|| {
            crate::cursor::token_parser::email_from_jwt(crate::cursor::token_parser::jwt_part(
                &parsed.access_token,
            ))
        })
        .unwrap_or_default()
}

fn write_account_to_state_db(state_db_path: &std::path::Path, parsed: &ParsedToken) -> AppResult<()> {
    let email = resolve_write_email(parsed);
    let access = &parsed.access_token;
    let refresh = parsed.refresh_token.as_deref().unwrap_or(access);

    state_vscdb::upsert_all(
        state_db_path,
        [
            ("cursorAuth/cachedSignUpType", "Auth_0"),
            ("cursorAuth/cachedEmail", email.as_str()),
            ("cursorAuth/accessToken", access.as_str()),
            ("cursorAuth/refreshToken", refresh),
            ("cursor.email", email.as_str()),
            ("cursor.accessToken", access.as_str()),
        ],
    )
}

fn write_account_to_storage_json(
    storage_json_path: &std::path::Path,
    parsed: &ParsedToken,
) -> AppResult<()> {
    storage_json::ensure_exists(storage_json_path)?;
    let mut root: Value = storage_json::read_or_empty(storage_json_path);

    let email = resolve_write_email(parsed);
    let access = parsed.access_token.clone();
    let refresh = parsed.refresh_token.clone().unwrap_or_else(|| access.clone());

    storage_json::set_dotted(&mut root, "cursorAuth.cachedSignUpType", json!("Auth_0"));
    storage_json::set_dotted(&mut root, "cursorAuth.cachedEmail", json!(email));
    storage_json::set_dotted(&mut root, "cursor.email", json!(email));
    storage_json::set_dotted(&mut root, "cursorAuth.accessToken", json!(access));
    storage_json::set_dotted(&mut root, "cursorAuth.refreshToken", json!(refresh));
    storage_json::set_dotted(&mut root, "cursor.accessToken", json!(access));

    storage_json::write_atomic(storage_json_path, &root)?;
    Ok(())
}
