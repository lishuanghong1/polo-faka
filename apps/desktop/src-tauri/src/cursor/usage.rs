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
const USAGE_EVENTS_URL: &str = "https://cursor.com/api/dashboard/get-filtered-usage-events";
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
    /// 赠送池总量（bonus / bonusLimit，cents→USD）
    #[serde(rename = "bonusQuotaUsd")]
    pub bonus_quota_usd: Option<f64>,
    /// 已从赠送池消耗的金额（bonusSpend）
    #[serde(rename = "bonusUsedUsd")]
    pub bonus_used_usd: Option<f64>,
    /// 兼容旧字段：等同 bonusUsedUsd
    #[serde(rename = "bonusSpendUsd")]
    pub bonus_spend_usd: Option<f64>,
    /// API 高级模型花费（apiSpend 或由 apiPercent × limit 推算）
    #[serde(rename = "apiSpendUsd")]
    pub api_spend_usd: Option<f64>,
    /// 超额 / 按需花费（individualUsage.onDemand.used）
    #[serde(rename = "overageSpendUsd")]
    pub overage_spend_usd: Option<f64>,

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

    let mut best: Option<UsageInfo> = None;
    let mut summary_body: Option<Value> = None;

    // 1. usage-summary + 完整会话串（商城同款）
    if let Ok((info, body)) = try_summary_session(&client, token).await {
        summary_body = Some(body);
        merge_usage_best(&mut best, info);
    }

    // 2. RPC：完整会话串 → 纯 JWT
    for bearer in [token, jwt] {
        if let Ok(info) = try_rpc(&client, bearer).await {
            merge_usage_best(&mut best, info);
        }
    }

    // 3. usage-summary：user_id + JWT 拼 Cookie
    if summary_body.is_none() {
        if let Some(uid) = user_id.as_ref() {
            if let Ok((info, body)) = try_summary(&client, jwt, uid).await {
                summary_body = Some(body);
                merge_usage_best(&mut best, info);
            }
        }
    }

    // 4. /auth/usage 兜底
    for bearer in [token, jwt] {
        if let Ok(info) = try_auth_usage(&client, bearer).await {
            merge_usage_best(&mut best, info);
        }
    }

    // 5. usage-events：商城号池同款，按账单周期汇总 chargedCents
    if let Ok(info) = try_usage_events(&client, token, summary_body.as_ref()).await {
        merge_usage_best(&mut best, info);
    }

    if let Some(mut info) = best {
        if has_usage_metrics(&info) {
            info.user_id = user_id;
            return Ok(info);
        }
        if info.plan.is_some() {
            return Err(AppError::Other(
                "已识别账号计划，但 Cursor 未返回用量明细（可能接口字段变更或账号无额度数据）".into(),
            ));
        }
    }

    Err(AppError::Other(
        "查询用量失败：所有备选接口都未返回有效数据，可能是 token 失效或网络不通".into(),
    ))
}

/// 合并多接口结果：优先保留有数值的一方，plan 等元数据互补
fn merge_usage_best(best: &mut Option<UsageInfo>, incoming: UsageInfo) {
    match best {
        None => *best = Some(incoming),
        Some(cur) => {
            if has_usage_metrics(&incoming) && !has_usage_metrics(cur) {
                let plan = incoming.plan.clone().or_else(|| cur.plan.clone());
                let mut merged = incoming;
                if merged.plan.is_none() {
                    merged.plan = plan;
                }
                *cur = merged;
                return;
            }
            patch_usage_fields(cur, &incoming);
        }
    }
}

fn patch_usage_fields(dst: &mut UsageInfo, src: &UsageInfo) {
    macro_rules! fill {
        ($field:ident) => {
            if dst.$field.is_none() {
                dst.$field = src.$field.clone();
            }
        };
    }
    fill!(plan);
    fill!(total_spend_usd);
    fill!(included_spend_usd);
    fill!(limit_usd);
    fill!(remaining_usd);
    fill!(bonus_quota_usd);
    fill!(bonus_used_usd);
    fill!(bonus_spend_usd);
    fill!(api_spend_usd);
    fill!(overage_spend_usd);
    fill!(auto_percent);
    fill!(api_percent);
    fill!(total_percent);
    fill!(individual_limit_usd);
    fill!(individual_used_usd);
    fill!(period_start);
    fill!(period_end);
    fill!(requests_used);
    fill!(requests_limit);
}

fn has_usage_metrics(info: &UsageInfo) -> bool {
    info.total_spend_usd.is_some()
        || info.included_spend_usd.is_some()
        || info.limit_usd.is_some()
        || info.remaining_usd.is_some()
        || info.auto_percent.is_some()
        || info.api_percent.is_some()
        || info.total_percent.is_some()
        || info.requests_used.is_some()
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
) -> AppResult<(UsageInfo, Value)> {
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
    Ok((parse_summary_response(&body), body))
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
) -> AppResult<(UsageInfo, Value)> {
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
    Ok((parse_summary_response(&body), body))
}

/// 商城 `fetchCursorUsageEvents`：按账单窗口分页汇总 usageEventsDisplay.chargedCents
async fn try_usage_events(
    client: &reqwest::Client,
    session_token: &str,
    summary: Option<&Value>,
) -> AppResult<UsageInfo> {
    let (start_ms, end_ms) = billing_window_ms(summary);
    let mut total_cents = 0.0_f64;
    let page_size = 500_u64;

    for page in 1_u64..=10 {
        let body = serde_json::json!({
            "page": page,
            "pageSize": page_size,
            "startDate": start_ms,
            "endDate": end_ms,
        });
        let resp = client
            .post(USAGE_EVENTS_URL)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .header("Cookie", format!("WorkosCursorSessionToken={session_token}"))
            .header("Authorization", format!("Bearer {session_token}"))
            .header("Referer", "https://cursor.com/dashboard/usage")
            .header("Origin", "https://cursor.com")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("usage-events 请求失败：{e}")))?;

        let status = resp.status();
        if !status.is_success() {
            return Err(AppError::Other(format!("usage-events HTTP {status}")));
        }
        let data: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Other(format!("usage-events 响应解析失败：{e}")))?;

        let events = data
            .get("usageEventsDisplay")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for event in &events {
            if let Some(c) = event.get("chargedCents").and_then(|v| v.as_f64()) {
                total_cents += c;
            }
        }

        if (events.len() as u64) < page_size {
            break;
        }
    }

    if total_cents <= 0.0 {
        return Err(AppError::Other("usage-events 未返回有效花费".into()));
    }

    let usd = total_cents / 100.0;
    let mut info = UsageInfo {
        total_spend_usd: Some(usd),
        included_spend_usd: Some(usd),
        source: "usage_events".into(),
        ..Default::default()
    };

    if let Some(summary) = summary {
        enrich_from_summary_body(&mut info, summary);
    }

    Ok(info)
}

fn billing_window_ms(summary: Option<&Value>) -> (String, String) {
    let end = summary
        .and_then(|s| {
            pick_date(
                s,
                &[
                    "billingCycleEnd",
                    "currentPeriodEnd",
                    "periodEnd",
                    "endDate",
                ],
            )
        })
        .and_then(|s| parse_rfc3339_ms(&s))
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    let start = summary
        .and_then(|s| {
            pick_date(
                s,
                &[
                    "billingCycleStart",
                    "currentPeriodStart",
                    "periodStart",
                    "startDate",
                ],
            )
        })
        .and_then(|s| parse_rfc3339_ms(&s))
        .unwrap_or(end - 31 * 24 * 60 * 60 * 1000);

    (start.to_string(), end.to_string())
}

fn parse_rfc3339_ms(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
        .or_else(|| s.parse::<i64>().ok())
}

fn enrich_from_summary_body(info: &mut UsageInfo, summary: &Value) {
    patch_usage_fields(info, &parse_summary_response(summary));
    if let (Some(limit), Some(used)) = (info.limit_usd, info.included_spend_usd) {
        if info.remaining_usd.is_none() {
            info.remaining_usd = Some((limit - used).max(0.0));
        }
        if info.total_percent.is_none() && limit > 0.0 {
            info.total_percent = Some((used / limit) * 100.0);
        }
    }
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
    let plan_usage = body
        .get("planUsage")
        .or_else(|| body.pointer("/data/planUsage"));
    let spend_limit = body
        .get("spendLimitUsage")
        .or_else(|| body.pointer("/data/spendLimitUsage"));
    let billing = body
        .get("billingPeriod")
        .or_else(|| body.pointer("/data/billingPeriod"));

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
        bonus_quota_usd: cents(plan_usage, "bonus"),
        bonus_used_usd: cents(plan_usage, "bonusSpend"),
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

/// Cockpit Tools 同款：从 `individualUsage.plan` / `planUsage` 等嵌套块读配额
fn pick_bonus_fields(plan: &Value, body: &Value) -> (Option<f64>, Option<f64>) {
    let quota = cents_from(plan, &["bonus", "bonusLimit", "bonus_limit"])
        .or_else(|| {
            body.pointer("/individualUsage/bonus")
                .and_then(|v| v.as_f64())
                .map(|c| c / 100.0)
        })
        .or_else(|| {
            body.pointer("/individual_usage/bonus")
                .and_then(|v| v.as_f64())
                .map(|c| c / 100.0)
        });
    let used = cents_from(plan, &["bonusSpend", "bonus_spend"])
        .or_else(|| {
            body.pointer("/individualUsage/bonusSpend")
                .and_then(|v| v.as_f64())
                .map(|c| c / 100.0)
        })
        .or_else(|| {
            body.pointer("/individual_usage/bonusSpend")
                .and_then(|v| v.as_f64())
                .map(|c| c / 100.0)
        });
    (quota, used)
}

fn pick_plan_block<'a>(body: &'a Value) -> Option<&'a Value> {
    body.pointer("/individualUsage/plan")
        .or_else(|| body.pointer("/individual_usage/plan"))
        .or_else(|| body.get("planUsage"))
        .or_else(|| body.get("plan_usage"))
        .or_else(|| body.pointer("/data/planUsage"))
}

fn cents_from(obj: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        obj.get(*key)
            .and_then(|v| v.as_f64())
            .map(|c| c / 100.0)
    })
}

fn pct_from(obj: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| obj.get(*key).and_then(|v| v.as_f64()))
}

fn parse_plan_block(plan: &Value, body: &Value) -> UsageInfo {
    // Cockpit：planUsed=used|totalSpend，套餐计入=includedSpend，两者可能不同
    let included_spend_usd = cents_from(plan, &["includedSpend", "included_spend"]);
    let total_spend_usd = cents_from(plan, &["used", "totalSpend", "total_spend"]);
    let plan_used_usd = included_spend_usd.or(total_spend_usd);
    let limit_usd = cents_from(plan, &["limit"]);
    let remaining_usd = cents_from(plan, &["remaining"]).or_else(|| {
        match (limit_usd, included_spend_usd.or(total_spend_usd)) {
            (Some(l), Some(u)) => Some(l - u),
            _ => None,
        }
    });

    let auto_percent = pct_from(plan, &["autoPercentUsed", "auto_percent_used"]);
    let api_percent = pct_from(plan, &["apiPercentUsed", "api_percent_used"]);
    let mut total_percent = pct_from(plan, &["totalPercentUsed", "total_percent_used"]);
    if total_percent.is_none() {
        if let (Some(u), Some(l)) = (plan_used_usd, limit_usd) {
            if l > 0.0 {
                total_percent = Some((u / l) * 100.0);
            }
        }
    }

    let spend_limit = body
        .get("spendLimitUsage")
        .or_else(|| body.get("spend_limit_usage"));
    let on_demand = body
        .pointer("/individualUsage/onDemand")
        .or_else(|| body.pointer("/individual_usage/onDemand"))
        .or_else(|| body.pointer("/teamUsage/onDemand"))
        .or_else(|| body.pointer("/team_usage/onDemand"))
        .or(spend_limit);

    let (bonus_quota_usd, bonus_used_usd) = pick_bonus_fields(plan, body);

    let breakdown = plan.get("breakdown");
    let api_spend_usd = cents_from(plan, &["apiSpend", "apiUsed", "api_spend"])
        .or_else(|| breakdown.and_then(|b| cents_from(b, &["api", "apiSpend"])))
        .or_else(|| {
            match (limit_usd, auto_percent, api_percent) {
                (Some(l), _, Some(p)) if p > 0.0 => Some(l * p / 100.0),
                _ => None,
            }
        });

    let mut overage_spend_usd = on_demand.and_then(|o| {
        cents_from(
            o,
            &["used", "totalSpend", "total_spend", "individualUsed", "individual_used"],
        )
    });
    if overage_spend_usd.is_none() {
        overage_spend_usd = spend_limit.and_then(|o| {
            cents_from(
                o,
                &["used", "individualUsed", "individual_used", "pooledUsed", "pooled_used"],
            )
        });
    }

    UsageInfo {
        plan: pick_plan_name(body),
        total_spend_usd: total_spend_usd.or(included_spend_usd),
        included_spend_usd: included_spend_usd.or(total_spend_usd),
        limit_usd,
        remaining_usd,
        bonus_quota_usd,
        bonus_used_usd,
        bonus_spend_usd: bonus_used_usd,
        api_spend_usd,
        overage_spend_usd,
        auto_percent,
        api_percent,
        total_percent,
        individual_limit_usd: on_demand.and_then(|o| {
            cents_from(o, &["limit", "individualLimit", "individual_limit"])
        }),
        individual_used_usd: on_demand.and_then(|o| {
            cents_from(o, &["used", "individualUsed", "individual_used", "totalSpend"])
        }),
        period_start: pick_date(body, &["billingCycleStart", "periodStart", "startDate"]),
        period_end: pick_date(body, &["billingCycleEnd", "periodEnd", "endDate"]),
        source: "usage_summary".into(),
        ..Default::default()
    }
}

/// 解析 cursor.com/api/usage-summary 的返回（字段名多变，尽量多路径命中）
fn parse_summary_response(body: &Value) -> UsageInfo {
    // Cockpit Tools 主路径：individualUsage.plan（新版 usage-summary）
    if let Some(plan_block) = pick_plan_block(body) {
        let info = parse_plan_block(plan_block, body);
        if has_usage_metrics(&info) || info.plan.is_some() {
            return info;
        }
    }

    // 旧版 summary 可能内嵌与 RPC 相同的 planUsage 结构
    if body.get("planUsage").is_some() || body.pointer("/data/planUsage").is_some() {
        let mut info = parse_rpc_response(body);
        info.source = "usage_summary".into();
        if info.plan.is_none() {
            info.plan = pick_plan_name(body);
        }
        if info.period_start.is_none() {
            info.period_start = pick_date(body, &["billingCycleStart", "periodStart", "startDate"]);
        }
        if info.period_end.is_none() {
            info.period_end = pick_date(body, &["billingCycleEnd", "periodEnd", "endDate"]);
        }
        return info;
    }

    let mut info = UsageInfo {
        plan: pick_plan_name(body),
        total_spend_usd: pick_money(body, &[
            "/totalSpendUsd",
            "/totalSpend",
            "/totalCost",
            "/used",
            "/spent",
            "/data/totalSpendUsd",
            "/data/used",
        ]),
        included_spend_usd: pick_money(body, &[
            "/includedSpendUsd",
            "/includedSpend",
            "/includedSpendCents",
            "/data/includedSpend",
        ]),
        limit_usd: pick_money(body, &[
            "/limitUsd",
            "/limit",
            "/totalQuota",
            "/quota",
            "/hardLimit",
            "/data/limit",
            "/data/totalQuota",
        ]),
        remaining_usd: pick_money(body, &[
            "/remainingUsd",
            "/remaining",
            "/quotaRemain",
            "/data/remaining",
        ]),
        bonus_quota_usd: pick_money(body, &["/bonusUsd", "/bonus", "/data/bonus"]),
        bonus_used_usd: pick_money(body, &["/bonusSpendUsd", "/bonusSpend", "/data/bonusSpend"]),
        bonus_spend_usd: pick_money(body, &["/bonusSpendUsd", "/bonusSpend", "/data/bonusSpend"]),
        auto_percent: pick_f64(body, &["/autoPercentUsed", "/autoUsagePercent", "/data/autoPercentUsed"]),
        api_percent: pick_f64(body, &["/apiPercentUsed", "/apiUsagePercent", "/data/apiPercentUsed"]),
        total_percent: pick_f64(body, &[
            "/totalPercentUsed",
            "/usagePercent",
            "/data/totalPercentUsed",
        ]),
        individual_limit_usd: pick_money(body, &[
            "/individualLimitUsd",
            "/individualLimit",
            "/individualLimitCents",
        ]),
        individual_used_usd: pick_money(body, &[
            "/individualUsedUsd",
            "/individualUsed",
            "/individualUsedCents",
        ]),
        period_start: pick_date(body, &["billingCycleStart", "periodStart", "startDate"]),
        period_end: pick_date(body, &["billingCycleEnd", "periodEnd", "endDate"]),
        source: "usage_summary".into(),
        ..Default::default()
    };

    // 若仍无额度字段，尝试从嵌套 data 再捞一遍
    if !has_usage_metrics(&info) {
        if let Some(data) = body.get("data") {
            let nested = parse_summary_response(data);
            patch_usage_fields(&mut info, &nested);
        }
    }

    // 与商城 parseCursorSummary 对齐：递归按 key 名匹配金额
    if !has_usage_metrics(&info) {
        apply_summary_money_fallback(&mut info, body);
    }

    info
}

fn apply_summary_money_fallback(info: &mut UsageInfo, body: &Value) {
    let used = first_money(
        body,
        &[
            "used",
            "usedQuota",
            "usage",
            "usageCost",
            "totalCost",
            "currentUsage",
            "currentSpend",
            "spend",
            "spent",
            "usedCents",
            "usageCents",
            "totalCostCents",
            "data.used",
            "data.usedCents",
            "data.totalCost",
        ],
    )
    .or_else(|| find_money_by_key(body, key_matches_used));

    let remain = first_money(
        body,
        &[
            "remain",
            "remaining",
            "quotaRemain",
            "remainingQuota",
            "remainingCents",
            "data.remaining",
            "data.remainingCents",
        ],
    )
    .or_else(|| {
        find_money_by_key(body, |k| {
            let kl = k.to_ascii_lowercase();
            kl.contains("remain") || kl.contains("remaining")
        })
    });

    let limit = first_money(
        body,
        &[
            "total",
            "totalQuota",
            "limit",
            "quota",
            "budget",
            "hardLimit",
            "limitCents",
            "totalCents",
            "data.limit",
            "data.totalQuota",
        ],
    )
    .or_else(|| find_money_by_key(body, key_matches_limit));

    let limit = limit.or_else(|| match (used, remain) {
        (Some(u), Some(r)) => Some(u + r),
        _ => None,
    });

    if let Some(u) = used {
        info.included_spend_usd = info.included_spend_usd.or(Some(u));
        info.total_spend_usd = info.total_spend_usd.or(Some(u));
    }
    if let Some(l) = limit {
        info.limit_usd = info.limit_usd.or(Some(l));
    }
    if let (Some(l), Some(u)) = (info.limit_usd, info.included_spend_usd) {
        if info.remaining_usd.is_none() {
            info.remaining_usd = Some((l - u).max(0.0));
        }
        if info.total_percent.is_none() && l > 0.0 {
            info.total_percent = Some((u / l) * 100.0);
        }
    }
}

fn first_money(body: &Value, paths: &[&str]) -> Option<f64> {
    paths.iter().find_map(|path| {
        let v = json_path(body, path)?;
        let n = parse_money_like(v)?;
        if path.to_ascii_lowercase().contains("cent") {
            Some(n / 100.0)
        } else {
            Some(n)
        }
    })
}

fn json_path<'a>(body: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = body;
    for key in path.split('.') {
        cur = cur.get(key)?;
    }
    Some(cur)
}

fn parse_money_like(v: &Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        return Some(n);
    }
    if let Some(s) = v.as_str() {
        let cleaned: String = s
            .chars()
            .filter(|c| !matches!(c, '$' | ',' | ' ') && !c.is_whitespace())
            .collect();
        if let Ok(n) = cleaned.parse::<f64>() {
            return Some(n);
        }
    }
    None
}

fn find_money_by_key(body: &Value, matcher: fn(&str) -> bool) -> Option<f64> {
    find_money_by_key_inner(body, matcher, &mut Vec::new())
}

fn find_money_by_key_inner(body: &Value, matcher: fn(&str) -> bool, seen: &mut Vec<usize>) -> Option<f64> {
    let ptr = body as *const Value as usize;
    if seen.contains(&ptr) {
        return None;
    }
    seen.push(ptr);

    match body {
        Value::Object(map) => {
            for (key, val) in map {
                if matcher(key) {
                    if let Some(n) = parse_money_like(val) {
                        return Some(if key.to_ascii_lowercase().contains("cent") {
                            n / 100.0
                        } else {
                            n
                        });
                    }
                }
                if let Some(n) = find_money_by_key_inner(val, matcher, seen) {
                    return Some(n);
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                if let Some(n) = find_money_by_key_inner(item, matcher, seen) {
                    return Some(n);
                }
            }
        }
        _ => {}
    }
    None
}

fn key_matches_used(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    (k.contains("used")
        || k.contains("spend")
        || k.contains("spent")
        || k.contains("cost")
        || k.contains("charged")
        || k.contains("amount"))
        && !(k.contains("limit")
            || k.contains("quota")
            || k.contains("budget")
            || k.contains("allowance")
            || k.contains("remaining")
            || k.contains("remain"))
}

fn key_matches_limit(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    (k.contains("limit")
        || k.contains("quota")
        || k.contains("budget")
        || k.contains("allowance")
        || k.contains("total"))
        && !(k.contains("used")
            || k.contains("usage")
            || k.contains("spend")
            || k.contains("spent")
            || k.contains("cost")
            || k.contains("charged")
            || k.contains("amount"))
}

fn pick_plan_name(body: &Value) -> Option<String> {
    ["membershipType", "plan", "membership.plan", "data.membershipType", "data.plan"]
        .iter()
        .find_map(|p| body.pointer(&format!("/{}", p.replace('.', "/"))).and_then(|v| v.as_str()))
        .map(|s| s.to_string())
}

fn pick_f64(body: &Value, paths: &[&str]) -> Option<f64> {
    paths.iter().find_map(|p| body.pointer(p).and_then(|v| v.as_f64()))
}

fn pick_date(body: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(s) = body.get(key).and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
        let ptr = format!("/billingPeriod/{}", key);
        if let Some(s) = body.pointer(&ptr).and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
        let ptr = format!("/data/{}", key);
        if let Some(s) = body.pointer(&ptr).and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
    }
    None
}

/// 读金额：自动识别 cents 字段并换算成 USD
fn pick_money(body: &Value, paths: &[&str]) -> Option<f64> {
    paths.iter().find_map(|p| {
        let v = body.pointer(p)?;
        let n = v.as_f64()?;
        if p.to_ascii_lowercase().contains("cent") {
            Some(n / 100.0)
        } else {
            Some(n)
        }
    })
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
