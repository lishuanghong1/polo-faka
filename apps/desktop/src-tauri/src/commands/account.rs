use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cursor::{
    machine_id::{apply as apply_machine_ids, NewMachineIds},
    paths::CursorPaths,
    process,
    state_vscdb, storage_json,
    token_parser::{self, ParsedToken},
};
use crate::error::{AppError, AppResult};

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
    #[serde(rename = "backupDir")]
    pub backup_dir: String,
    #[serde(rename = "resetMachineId")]
    pub reset_machine_id: bool,
    pub relaunched: bool,
    #[serde(rename = "newDeviceId")]
    pub new_device_id: Option<String>,
}

#[tauri::command]
pub fn parse_token(raw: String) -> AppResult<ParsedToken> {
    token_parser::parse(&raw)
}

/// 端到端：粘贴内容 → 解析 → 关 Cursor → 备份 → 写 state.vscdb + storage.json
/// （可选）重置机器码 → （可选）重启 Cursor
#[tauri::command]
pub fn import_account(payload: ImportPayload) -> AppResult<ImportResult> {
    let parsed = token_parser::parse(&payload.raw)?;

    let paths = CursorPaths::detect()?;
    if !paths.is_installed() {
        return Err(AppError::CursorNotFound);
    }

    // 关掉 Cursor 释放文件锁
    if process::is_running() {
        process::kill_all()?;
    }

    // 备份
    let backup_dir = CursorPaths::new_backup_dir()?;
    storage_json::backup(&paths.storage_json, &backup_dir)?;
    state_vscdb::backup(&paths.state_db, &backup_dir)?;

    // 1. 写 state.vscdb（Cursor 实际读这里的更多）
    write_account_to_state_db(&paths.state_db, &parsed)?;

    // 2. 同步写 storage.json（双保险 + 兼容老版本）
    write_account_to_storage_json(&paths.storage_json, &parsed)?;

    // 3. 可选：重置机器码
    let new_device_id = if payload.reset_machine_id {
        let ids = NewMachineIds::generate();
        apply_machine_ids(&paths, &ids)?;
        Some(ids.dev_device_id)
    } else {
        None
    };

    // 4. 可选：重新拉起 Cursor
    let relaunched = if payload.kill_and_relaunch {
        process::launch()?
    } else {
        false
    };

    Ok(ImportResult {
        email: parsed.email,
        backup_dir: backup_dir.to_string_lossy().into_owned(),
        reset_machine_id: payload.reset_machine_id,
        relaunched,
        new_device_id,
    })
}

fn write_account_to_state_db(state_db_path: &std::path::Path, parsed: &ParsedToken) -> AppResult<()> {
    let email = parsed.email.clone().unwrap_or_default();
    let access = &parsed.access_token;
    let refresh = parsed.refresh_token.as_deref().unwrap_or(access);

    state_vscdb::upsert_all(
        state_db_path,
        [
            ("cursorAuth/cachedSignUpType", "Auth_0"),
            ("cursorAuth/cachedEmail", email.as_str()),
            ("cursorAuth/accessToken", access.as_str()),
            ("cursorAuth/refreshToken", refresh),
            // 不强制设置会员类型，让 Cursor 自己刷
        ],
    )
}

fn write_account_to_storage_json(
    storage_json_path: &std::path::Path,
    parsed: &ParsedToken,
) -> AppResult<()> {
    storage_json::ensure_exists(storage_json_path)?;
    let mut root: Value = storage_json::read_or_empty(storage_json_path);

    let email = parsed.email.clone().unwrap_or_default();
    let access = parsed.access_token.clone();
    let refresh = parsed.refresh_token.clone().unwrap_or_else(|| access.clone());

    storage_json::set_dotted(&mut root, "cursorAuth.cachedSignUpType", json!("Auth_0"));
    storage_json::set_dotted(&mut root, "cursorAuth.cachedEmail", json!(email));
    storage_json::set_dotted(&mut root, "cursorAuth.accessToken", json!(access));
    storage_json::set_dotted(&mut root, "cursorAuth.refreshToken", json!(refresh));

    storage_json::write_atomic(storage_json_path, &root)?;
    Ok(())
}
