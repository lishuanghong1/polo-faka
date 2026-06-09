use std::sync::Arc;

use tauri::State;

use crate::error::AppResult;
use crate::refresh::RefreshController;
use crate::store::settings::{self, AppSettings};
use crate::store::Store;

#[tauri::command]
pub fn get_settings(store: State<'_, Store>) -> AppResult<AppSettings> {
    store.with_conn(|c| settings::load(c))
}

#[tauri::command]
pub fn save_settings(
    store: State<'_, Store>,
    refresh: State<'_, Arc<RefreshController>>,
    payload: AppSettings,
) -> AppResult<AppSettings> {
    store.with_conn(|c| settings::save(c, &payload))?;
    refresh.update_interval(payload.auto_refresh_seconds);
    Ok(payload)
}
