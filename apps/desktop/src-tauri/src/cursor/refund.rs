//! 「回收」：用账号的会话串向 Cursor 支持入口提交退款请求。
//!
//! 参考网页 `cursor.com/cn/help` 的请求：
//!   POST https://cursor.com/api/help/support/classify
//!   - 鉴权：Cookie `WorkosCursorSessionToken=<user_xxx::jwt>` + `Authorization: Bearer <同值>`
//!   - body：`{ "message": "<退款申请正文>" }`
//!
//! 正文里的邮箱从账号 token / 账号库取；购买日期尽力从用量接口的账单周期起始拿
//! （Cursor 没有公开的发票号 JSON 接口，发票号只能在 Stripe 账单门户里看，故默认留空）。

use serde::Serialize;
use serde_json::Value;

use crate::cursor::token_parser;
use crate::cursor::usage;
use crate::error::{AppError, AppResult};

const CLASSIFY_URL: &str = "https://cursor.com/api/help/support/classify";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
    (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize)]
pub struct RefundResult {
    /// 正文使用的账号邮箱
    pub email: Option<String>,
    /// 发票号（Cursor 无公开接口，通常为空）
    #[serde(rename = "invoiceNumber")]
    pub invoice_number: Option<String>,
    /// 购买日期（尽力取账单周期起始）
    #[serde(rename = "purchaseDate")]
    pub purchase_date: Option<String>,
    /// 实际发送给 Cursor 的 message 全文
    pub message: String,
    /// classify 接口返回的原始 JSON
    pub response: Value,
}

/// 用账号会话串提交退款（回收）请求。
/// - `token`：账号 access_token（会话串 `user_xxx::jwt` 或纯 JWT 均可）
/// - `email_hint`：账号库已知 email（拿不到时回退 JWT 解析）
/// - `invoice`：手动填写的发票号（选填；Cursor 无接口可自动获取）
pub async fn submit(
    token: &str,
    email_hint: Option<&str>,
    invoice: Option<&str>,
) -> AppResult<RefundResult> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AppError::Other("账号 token 为空".into()));
    }

    let jwt = token_parser::jwt_part(token);
    let email = email_hint
        .map(|s| s.trim().to_string())
        .filter(|s| s.contains('@'))
        .or_else(|| token_parser::email_from_jwt(jwt));

    let invoice_number = invoice
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // 购买日期：尽力从用量接口的账单周期起始取（best-effort，失败不阻断）
    let purchase_date = fetch_purchase_date(token).await;

    let message = build_message(
        email.as_deref(),
        invoice_number.as_deref(),
        purchase_date.as_deref(),
    );

    let client = build_client()?;
    let body = serde_json::json!({ "message": message });
    let resp = client
        .post(CLASSIFY_URL)
        .header("Accept", "*/*")
        .header("Content-Type", "application/json")
        .header("Origin", "https://cursor.com")
        .header("Referer", "https://cursor.com/cn/help")
        .header("Cookie", format!("WorkosCursorSessionToken={token}"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("提交回收请求失败：{e}")))?;

    let status = resp.status();
    let value: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(AppError::Other(format!(
            "Cursor 接口返回 HTTP {status}：{value}"
        )));
    }

    Ok(RefundResult {
        email,
        invoice_number,
        purchase_date,
        message,
        response: value,
    })
}

/// 尽力取购买日期（账单周期起始）。Cursor 无发票号接口，故只返回日期。
async fn fetch_purchase_date(token: &str) -> Option<String> {
    match usage::query(token).await {
        Ok(info) => info.period_start.as_deref().and_then(format_date),
        Err(_) => None,
    }
}

/// RFC3339 / `YYYY-MM-DD...` 前缀 → `YYYY-MM-DD`
fn format_date(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Some(dt.format("%Y-%m-%d").to_string());
    }
    let b = raw.as_bytes();
    if b.len() >= 10 && b[4] == b'-' && b[7] == b'-' {
        return Some(raw[..10].to_string());
    }
    None
}

fn build_message(email: Option<&str>, invoice: Option<&str>, date: Option<&str>) -> String {
    let email = email.unwrap_or("[Your Cursor Account Email]");
    let invoice_line = match invoice {
        Some(v) if !v.is_empty() => format!("Invoice Number: {v}\n\n"),
        _ => String::new(),
    };
    let date = date.unwrap_or("[Purchase Date]");
    format!(
        "Hello Cursor Support,\n\n\
         I would like to request a refund for my Cursor Pro subscription.\n\n\
         Account Email: {email}\n\n\
         {invoice_line}\
         Payment Method: Alipay\n\n\
         Purchase Date: {date}\n\n\
         I am requesting this refund within 24 hours of purchase.\n\n\
         I recently purchased Cursor Pro, but the subscription did not meet my expectations. \
         Therefore, I would like to request a refund and cancellation of my subscription.\n\n\
         I would appreciate your assistance with processing this refund.\n\n\
         Thank you for your time and support.\n\n\
         Best regards"
    )
}

fn build_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::Other(format!("HTTP 客户端构建失败：{e}")))
}
