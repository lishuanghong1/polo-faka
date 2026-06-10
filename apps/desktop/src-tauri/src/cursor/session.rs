use crate::cursor::{paths::CursorPaths, state_vscdb, storage_json};

/// 读取 Cursor 当前登录的 accessToken（state.vscdb 优先）
pub fn current_access_token(paths: &CursorPaths) -> Option<String> {
    if paths.state_db.exists() {
        if let Some(token) = state_vscdb::current_access_token(&paths.state_db) {
            return Some(token);
        }
    }
    if paths.storage_json.exists() {
        let root = storage_json::read_or_empty(&paths.storage_json);
        if let Some(token) = storage_json::current_access_token(&root) {
            return Some(token);
        }
    }
    None
}
