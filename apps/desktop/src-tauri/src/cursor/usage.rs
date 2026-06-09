//! 查询 Cursor 账号当前周期的用量。
//!
//! Cursor 没有公开的「个人用量 API」。社区反向工程的两条主要路径：
//!   1. POST  https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage
//!      - Connect RPC 风格，请求体 `{}`，Authorization: Bearer <jwt>
//!      - 返回结构化的 `planUsage` / `spendLimitUsage` / `billingPeriod`
//!   2. GET  https://cursor.com/api/usage-summary
//!      - Cookie 认证：`WorkosCursorSessionToken=<userId>%3A%3A<jwt>`
//!      - userId 可从 JWT payload 的 `sub` 字段（"auth0|user_xxx"）抽出
//!
//! 我们优先走 RPC（更稳定）；失败再降级到 Cookie，最大化命中率。

use serde::Serialize;
use serde_json::Value;

use crate::cursor::token_parser;
use crate::error::{AppError, AppResult};

const RPC_URL: &str =
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const SUMMARY_URL: &str = "https://cursor.com/api/usage-summary";
const AUTH_USAGE_URL: &str = "https://api2.cursor.sh/auth/usage";
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PoloAccountTool/0.1";

#[derive(Debug, Clone, Default, Serialize)]
pub struct UsageInfo {
    /// 计划名（Pro / Pro+ / Business / Free Trial …），不一定能拿到
    pub plan: Option<String>,
    /// JWT 解出来的用户 ID（不暴露 token）
    #[serde(rename = "userId")]
    pub user_id: Option<String>,

    // ── 金额（USD，已换算成元；原始数据是 cents）─────────────
    /// 本周期累计花费（含 bonus）
    #[serde(rename = "totalSpendUsd")]
    pub total_spend_usd: Option<f64>,
    /// 本周期计入额度的花费
    #[serde(rename = "includedSpendUsd")]
    pub included_spend_usd: Option<f64>,
    /// 周期总额度
    #[serde(rename = "limitUsd")]
    pub limit_usd: Option<f64>,
    /// 剩余额度（limit - includedSpend）
    #[serde(rename = "remainingUsd")]
    pub remaining_usd: Option<f64>,
    /// 模型方赠送的额度
    #[serde(rename = "bonusSpendUsd")]
    pub bonus_spend_usd: Option<f64>,

    // ── 百分比（0~100）─────────────
    #[serde(rename = "autoPercent")]
    pub auto_percent: Option<f64>,
    #[serde(rename = "apiPercent")]
    pub api_percent: Option<f64>,
    #[serde(rename = "totalPercent")]
    pub total_percent: Option<f64>,

    // ── 按需付费 (spending limit) ─────────────
    #[serde(rename = "individualLimitUsd")]
    pub individual_limit_usd: Option<f64>,
    #[serde(rename = "individualUsedUsd")]
    pub individual_used_usd: Option<f64>,

    // ── 周期 ─────────────
    #[serde(rename = "periodStart")]
    pub period_start: Option<String>,
    #[serde(rename = "periodEnd")]
    pub period_end: Option<String>,

    // ── Enterprise 请求计数（如有）─────────────
    #[serde(rename = "requestsUsed")]
    pub requests_used: Option<u64>,
    #[serde(rename = "requestsLimit")]
    pub requests_limit: Option<u64>,

    /// 数据来源：dashboard_rpc | usage_summary | auth_usage
    pub source: String,
}

/// 入口：查询用量。会话串 `user_xxx::jwt` 优先走 usage-summary（与商城号池一致）。
pub async fn query(token: &str) -> AppResult<UsageInfo> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AppError::Other("token 为空".into()));
    }
    let jwt = token_parser::jwt_part(token);

    let client = build_client()?;
    let user_id = token_parser::session_user_id(token);

    // 1. usage-summary + 完整会话串 Cookie/Bearer（商城后端同款）
    if let Ok(mut info) = try_summary_session(&client, token).await {
        info.user_id = user_id.clone();
        return Ok(info);
    }

    // 2. RPC：完整会话串
    if let Ok(mut info) = try_rpc(&client, token).await {
        info.user_id = user_id.clone();
        return Ok(info);
    }

    // 3. RPC：纯 JWT
    if token != jwt {
        if let Ok(mut info) = try_rpc(&client, jwt).await {
            info.user_id = user_id.clone();
            return Ok(info);
        }
    }

    // 4. usage-summary：user_id + JWT 拼 Cookie
    if let Some(uid) = user_id.as_ref() {
        if let Ok(mut info) = try_summary(&client, jwt, uid).await {
            info.user_id = user_id.clone();
            return Ok(info);
        }
    }

    // 5. /auth/usage 兜底
    for bearer in [token, jwt] {
        if let Ok(mut info) = try_auth_usage(&client, bearer).await {
            info.user_id = user_id.clone();
            return Ok(info);
        }
    }

    Err(AppError::Other(
        "查询用量失败：所有备选接口都未返回有效数据，可能是 token 失效或网络不通".into(),
    ))
}

fn build_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::Other(format!("HTTP 客户端构建失败：{e}")))
}

/// 从会话串或 JWT 提取 user_id（兼容 `user_xxx::jwt`）
pub fn extract_user_id(token: &str) -> Option<String> {
    token_parser::session_user_id(token)
}

/// 与商城 `cursorAuthHeaders` 一致：完整会话串同时放 Cookie 和 Bearer
async fn try_summary_session(
    client: &reqwest::Client,
    session_token: &str,
) -> AppResult<UsageInfo> {
    let resp = client
        .get(SUMMARY_URL)
        .header("Accept", "application/json")
        .header("Cookie", format!("WorkosCursorSessionToken={session_token}"))
        .header("Authorization", format!("Bearer {session_token}"))
        .header("Referer", "https://cursor.com/dashboard/usage")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Summary(session) 请求失败：{e}")))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Other(format!("Summary(session) HTTP {status}")));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("Summary(session) 响应解析失败：{e}")))?;
    Ok(parse_summary_response(&body))
}

async fn try_rpc(client: &reqwest::Client, bearer: &str) -> AppResult<UsageInfo> {
    let resp = client
        .post(RPC_URL)
        .header("Content-Type", "application/json")
        .header("Connect-Protocol-Version", "1")
        .header("Authorization", format!("Bearer {bearer}"))
        .body("{}")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("RPC 请求失败：{e}")))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Other(format!("RPC HTTP {status}")));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("RPC 响应解析失败：{e}")))?;
    Ok(parse_rpc_response(&body))
}

async fn try_summary(
    client: &reqwest::Client,
    jwt: &str,
    user_id: &str,
) -> AppResult<UsageInfo> {
    // Cookie 里需要 URL-encode 的 "::"
    let cookie = format!("WorkosCursorSessionToken={user_id}%3A%3A{jwt}");
    let resp = client
        .get(SUMMARY_URL)
        .header("Cookie", cookie)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Summary 请求失败：{e}")))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Other(format!("Summary HTTP {status}")));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("Summary 响应解析失败：{e}")))?;
    Ok(parse_summary_response(&body))
}

async fn try_auth_usage(
    client: &reqwest::Client,
    jwt: &str,
) -> AppResult<UsageInfo> {
    let resp = client
        .get(AUTH_USAGE_URL)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| AppError::Other(format!("auth/usage 请求失败：{e}")))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Other(format!("auth/usage HTTP {status}")));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("auth/usage 响应解析失败：{e}")))?;
    Ok(parse_auth_usage_response(&body))
}

/// 解析 GetCurrentPeriodUsage 的返回。
/// 响应体大致形如：
/// ```json
/// {
///   "planUsage": { "totalSpend":23222, "includedSpend":6222, "limit":40000,
///                  "remaining":16778, "bonusSpend":0,
///                  "autoPercentUsed":0, "apiPercentUsed":46.44, "totalPercentUsed":15.48 },
///   "spendLimitUsage": { "individualLimit":10000, "individualUsed":0 },
///   "billingPeriod": { "startDate":"...", "endDate":"..." },
///   "planInfo": { "name":"Pro" } 或 "plan":"Pro" 这种
/// }
/// ```
fn parse_rpc_response(body: &Value) -> UsageInfo {
    let plan_usage = body.get("planUsage");
    let spend_limit = body.get("spendLimitUsage");
    let billing = body.get("billingPeriod");

    let plan_name = body
        .pointer("/planInfo/name")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("plan").and_then(|v| v.as_str()))
        .or_else(|| body.pointer("/membership/plan").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    let cents = |obj: Option<&Value>, key: &str| -> Option<f64> {
        obj.and_then(|o| o.get(key))
            .and_then(|v| v.as_f64())
            .map(|c| c / 100.0)
    };
    let pct = |obj: Option<&Value>, key: &str| -> Option<f64> {
        obj.and_then(|o| o.get(key)).and_then(|v| v.as_f64())
    };
    let date_str = |obj: Option<&Value>, key: &str| -> Option<String> {
        obj.and_then(|o| o.get(key))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };

    UsageInfo {
        plan: plan_name,
        total_spend_usd: cents(plan_usage, "totalSpend"),
        included_spend_usd: cents(plan_usage, "includedSpend"),
        limit_usd: cents(plan_usage, "limit"),
        remaining_usd: cents(plan_usage, "remaining"),
        bonus_spend_usd: cents(plan_usage, "bonusSpend"),
        auto_percent: pct(plan_usage, "autoPercentUsed"),
        api_percent: pct(plan_usage, "apiPercentUsed"),
        total_percent: pct(plan_usage, "totalPercentUsed"),
        individual_limit_usd: cents(spend_limit, "individualLimit"),
        individual_used_usd: cents(spend_limit, "individualUsed"),
        period_start: date_str(billing, "startDate"),
        period_end: date_str(billing, "endDate"),
        source: "dashboard_rpc".into(),
        ..Default::default()
    }
}

/// 解析 cursor.com/api/usage-summary 的返回。字段名可能与 RPC 略不同；
/// 我们做"最大命中"的兼容映射，找不到的就留 None。
fn parse_summary_response(body: &Value) -> UsageInfo {
    let plan_name = body
        .pointer("/membershipType")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("plan").and_then(|v| v.as_str()))
        .or_else(|| body.pointer("/membership/plan").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    let f64_of = |path: &str| body.pointer(path).and_then(|v| v.as_f64());
    let str_of = |path: &str| body.pointer(path).and_then(|v| v.as_str()).map(String::from);

    UsageInfo {
        plan: plan_name,
        total_spend_usd: f64_of("/totalSpendUsd")
            .or_else(|| f64_of("/totalSpendCents").map(|c| c / 100.0)),
        included_spend_usd: f64_of("/includedSpendCents").map(|c| c / 100.0),
        limit_usd: f64_of("/limitCents").map(|c| c / 100.0),
        remaining_usd: f64_of("/remainingCents").map(|c| c / 100.0),
        bonus_spend_usd: f64_of("/bonusSpendCents").map(|c| c / 100.0),
        auto_percent: f64_of("/autoPercentUsed"),
        api_percent: f64_of("/apiPercentUsed"),
        total_percent: f64_of("/totalPercentUsed"),
        individual_limit_usd: f64_of("/individualLimitCents").map(|c| c / 100.0),
        individual_used_usd: f64_of("/individualUsedCents").map(|c| c / 100.0),
        period_start: str_of("/billingPeriod/startDate").or_else(|| str_of("/startDate")),
        period_end: str_of("/billingPeriod/endDate").or_else(|| str_of("/endDate")),
        source: "usage_summary".into(),
        ..Default::default()
    }
}

/// 解析 /auth/usage（Enterprise 风格，按请求数计的）
fn parse_auth_usage_response(body: &Value) -> UsageInfo {
    // 这个接口返回每个 model 的 bucket：{ "gpt-4": { numRequests, maxRequestUsage } …}
    // 找一个有意义的桶汇总。
    let mut used: u64 = 0;
    let mut max: u64 = 0;
    if let Some(obj) = body.as_object() {
        for (_k, v) in obj {
            if let Some(b) = v.as_object() {
                if let Some(n) = b.get("numRequests").and_then(|n| n.as_u64()) {
                    used = used.max(n);
                }
                if let Some(m) = b.get("maxRequestUsage").and_then(|m| m.as_u64()) {
                    max = max.max(m);
                }
            }
        }
    }
    UsageInfo {
        requests_used: if used > 0 { Some(used) } else { None },
        requests_limit: if max > 0 { Some(max) } else { None },
        source: "auth_usage".into(),
        ..Default::default()
    }
}
