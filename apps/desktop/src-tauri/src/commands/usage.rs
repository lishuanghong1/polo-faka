use crate::cursor::token_parser;
use crate::cursor::usage::{self, UsageInfo};
use crate::error::AppResult;

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
