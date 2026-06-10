use crate::cursor::paths::CursorPaths;
use crate::cursor::session;
use crate::cursor::token_parser;
use crate::cursor::usage::{self, UsageInfo};
use crate::error::{AppError, AppResult};

/// 直接给 token 查用量
#[tauri::command]
pub async fn query_usage(token: String) -> AppResult<UsageInfo> {
    usage::query(&token).await
}

/// 给原始粘贴内容查用量：内部先解析出 JWT 再查
#[tauri::command]
pub async fn query_usage_from_raw(raw: String) -> AppResult<UsageInfo> {
    let parsed = token_parser::parse(&raw)?;
    usage::query(&parsed.access_token).await
}

/// 读取本机 Cursor 当前登录 token 并查用量
#[tauri::command]
pub async fn query_current_usage() -> AppResult<UsageInfo> {
    let paths = CursorPaths::detect()?;
    if !paths.is_installed() {
        return Err(AppError::CursorNotFound);
    }
    let token = session::current_access_token(&paths)
        .ok_or_else(|| AppError::Other("未检测到 Cursor 登录 token".into()))?;
    usage::query(&token).await
}
