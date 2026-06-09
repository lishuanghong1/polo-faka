use serde::Serialize;

use crate::cursor::{paths::CursorPaths, process, storage_json};
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
        current_device_id: None,
    };

    if installed && paths.storage_json.exists() {
        let root = storage_json::read_or_empty(&paths.storage_json);
        info.current_email = storage_json::current_email(&root);
        info.current_device_id = storage_json::current_device_id(&root);
    }

    Ok(info)
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
