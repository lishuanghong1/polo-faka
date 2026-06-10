use serde::Serialize;

use std::fs;

use crate::cursor::{paths::CursorPaths, process, state_vscdb, storage_json, token_parser};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
pub struct CursorInfo {
    pub installed: bool,
    #[serde(rename = "configDir")]
    pub config_dir: Option<String>,
    #[serde(rename = "storageJsonPath")]
    pub storage_json_path: Option<String>,
    #[serde(rename = "stateDbPath")]
    pub state_db_path: Option<String>,
    #[serde(rename = "machineIdFilePath")]
    pub machine_id_file_path: Option<String>,
    pub running: bool,
    #[serde(rename = "currentEmail")]
    pub current_email: Option<String>,
    #[serde(rename = "currentUserId")]
    pub current_user_id: Option<String>,
    #[serde(rename = "currentDeviceId")]
    pub current_device_id: Option<String>,
}

#[tauri::command]
pub fn detect_cursor() -> AppResult<CursorInfo> {
    let paths = match CursorPaths::detect() {
        Ok(p) => p,
        Err(_) => {
            return Ok(CursorInfo {
                installed: false,
                config_dir: None,
                storage_json_path: None,
                state_db_path: None,
                machine_id_file_path: None,
                running: process::is_running(),
                current_email: None,
                current_user_id: None,
                current_device_id: None,
            })
        }
    };
    let installed = paths.is_installed();
    let mut info = CursorInfo {
        installed,
        config_dir: Some(paths.config_dir.to_string_lossy().into_owned()),
        storage_json_path: Some(paths.storage_json.to_string_lossy().into_owned()),
        state_db_path: Some(paths.state_db.to_string_lossy().into_owned()),
        machine_id_file_path: Some(paths.machine_id_file.to_string_lossy().into_owned()),
        running: process::is_running(),
        current_email: None,
        current_user_id: None,
        current_device_id: None,
    };

    if installed {
        info.current_email = read_current_email(&paths);
        info.current_user_id = read_current_user_id(&paths);
        info.current_device_id = read_current_device_id(&paths);
    }

    Ok(info)
}

fn read_current_email(paths: &CursorPaths) -> Option<String> {
    // 1. state.vscdb（Cursor 实际登录态，优先）
    if paths.state_db.exists() {
        if let Some(email) = state_vscdb::current_email(&paths.state_db) {
            return Some(email);
        }
        if let Some(token) = state_vscdb::current_access_token(&paths.state_db) {
            if let Some(email) = token_parser::email_from_jwt(token_parser::jwt_part(&token)) {
                return Some(email);
            }
        }
    }

    // 2. storage.json
    if paths.storage_json.exists() {
        let root = storage_json::read_or_empty(&paths.storage_json);
        if let Some(email) = storage_json::current_email(&root) {
            return Some(email);
        }
        if let Some(token) = storage_json::current_access_token(&root) {
            if let Some(email) = token_parser::email_from_jwt(token_parser::jwt_part(&token)) {
                return Some(email);
            }
        }
    }

    None
}

fn read_current_user_id(paths: &CursorPaths) -> Option<String> {
    if paths.state_db.exists() {
        if let Some(uid) = state_vscdb::current_user_id(&paths.state_db) {
            return Some(normalize_cursor_user_id(&uid));
        }
        if let Some(token) = state_vscdb::current_access_token(&paths.state_db) {
            if let Some(uid) = token_parser::session_user_id(&token) {
                return Some(uid);
            }
        }
    }
    if paths.storage_json.exists() {
        let root = storage_json::read_or_empty(&paths.storage_json);
        if let Some(token) = storage_json::current_access_token(&root) {
            if let Some(uid) = token_parser::session_user_id(&token) {
                return Some(uid);
            }
        }
    }
    None
}

/// `auth0|user_xxx` → `user_xxx`
fn normalize_cursor_user_id(raw: &str) -> String {
    let t = raw.trim();
    t.rsplit('|').next().unwrap_or(t).to_string()
}

fn read_current_device_id(paths: &CursorPaths) -> Option<String> {
    if paths.state_db.exists() {
        if let Some(id) = state_vscdb::current_device_id(&paths.state_db) {
            return Some(id);
        }
    }
    if paths.storage_json.exists() {
        let root = storage_json::read_or_empty(&paths.storage_json);
        if let Some(id) = storage_json::current_device_id(&root) {
            return Some(id);
        }
    }
    if paths.machine_id_file.exists() {
        if let Ok(raw) = fs::read_to_string(&paths.machine_id_file) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub fn kill_cursor() -> AppResult<bool> {
    process::kill_all()?;
    Ok(true)
}

#[tauri::command]
pub fn launch_cursor() -> AppResult<bool> {
    process::launch()
}
