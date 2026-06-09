use serde::Serialize;

use crate::cursor::{machine_id::NewMachineIds, paths::CursorPaths, process, storage_json};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct ResetResult {
    #[serde(rename = "devDeviceId")]
    pub dev_device_id: String,
    #[serde(rename = "machineId")]
    pub machine_id: String,
    #[serde(rename = "macMachineId")]
    pub mac_machine_id: String,
    #[serde(rename = "sqmId")]
    pub sqm_id: String,
    #[serde(rename = "backupDir")]
    pub backup_dir: String,
}

/// 单独重置机器码（不动账号）。会先确保 Cursor 已关闭。
#[tauri::command]
pub fn reset_machine_id() -> AppResult<ResetResult> {
    let paths = CursorPaths::detect()?;
    if !paths.is_installed() {
        return Err(AppError::CursorNotFound);
    }

    if process::is_running() {
        process::kill_all()?;
    }

    let backup_dir = CursorPaths::new_backup_dir()?;
    storage_json::backup(&paths.storage_json, &backup_dir)?;

    let ids = NewMachineIds::generate();
    crate::cursor::machine_id::apply(&paths, &ids)?;

    Ok(ResetResult {
        dev_device_id: ids.dev_device_id,
        machine_id: ids.machine_id,
        mac_machine_id: ids.mac_machine_id,
        sqm_id: ids.sqm_id,
        backup_dir: backup_dir.to_string_lossy().into_owned(),
    })
}
