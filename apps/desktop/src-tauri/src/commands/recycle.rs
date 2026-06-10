use tauri::State;

use crate::cursor::refund::{self, RefundResult};
use crate::error::{AppError, AppResult};
use crate::store::{accounts, Store};

/// 「回收」：按账号库里的邮箱找到账号 token，向 Cursor 提交退款请求。
/// `invoice_number`（JS 端 `invoiceNumber`）选填，Cursor 无接口可自动取。
#[tauri::command]
pub async fn submit_recycle(
    store: State<'_, Store>,
    email: String,
    invoice_number: Option<String>,
) -> AppResult<RefundResult> {
    let email = email.trim().to_string();
    if email.is_empty() {
        return Err(AppError::Other("请先选择或输入账号邮箱".into()));
    }

    // 账号库通常很小，直接列出后大小写不敏感匹配
    let all = store.with_conn(|c| accounts::list(c))?;
    let needle = email.to_ascii_lowercase();
    let account = all
        .into_iter()
        .find(|a| {
            a.email
                .as_deref()
                .map(|e| e.trim().to_ascii_lowercase() == needle)
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            AppError::Other(format!("账号库里没有「{email}」，请先在账号库导入该账号"))
        })?;

    refund::submit(
        &account.access_token,
        account.email.as_deref(),
        invoice_number.as_deref(),
    )
    .await
}
