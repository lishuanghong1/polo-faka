//! 用户设置：自动刷新间隔、配额阈值、是否启用预警等。
//! 用一个简单的 key-value 表存储，配合 typed 接口。

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

pub fn ensure_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(SCHEMA)?;
    Ok(())
}

/// 用户配置（前端可整体读写）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// 自动刷新间隔（秒）。0 = 关闭。
    #[serde(rename = "autoRefreshSeconds")]
    pub auto_refresh_seconds: u64,
    /// 是否启用配额预警弹通知
    #[serde(rename = "quotaAlertEnabled")]
    pub quota_alert_enabled: bool,
    /// 警告阈值（%）；超过即弹「警告」
    #[serde(rename = "warnPercent")]
    pub warn_percent: f64,
    /// 紧急阈值（%）；超过即弹「严重」
    #[serde(rename = "criticalPercent")]
    pub critical_percent: f64,
    /// 默认导入时是否重置机器码
    #[serde(rename = "defaultResetMachineId")]
    pub default_reset_machine_id: bool,
    /// 默认导入后是否自动拉起 Cursor
    #[serde(rename = "defaultRelaunch")]
    pub default_relaunch: bool,

    // ── 商城 / 号池联动 ─────────────
    /// 商城后端 base URL，默认指向我们的线上站点
    #[serde(rename = "shopBaseUrl")]
    pub shop_base_url: String,
    /// 缓存的登录 JWT（用于号池接口认证）；过期需要重新登录
    #[serde(rename = "shopJwt")]
    pub shop_jwt: Option<String>,
    /// 缓存的登录用户名（仅展示用）
    #[serde(rename = "shopUsername")]
    pub shop_username: Option<String>,
    /// 是否启用号池自动换号 / 自动下机调度
    #[serde(rename = "poolAutoEnabled")]
    pub pool_auto_enabled: bool,
    /// 用量超过此阈值（%）→ 自动换号；0 = 关闭
    #[serde(rename = "poolSwapThresholdPercent")]
    pub pool_swap_threshold_percent: f64,
    /// 用量到 100% 时除了释放号外，是否清掉 Cursor 本机登录态
    #[serde(rename = "poolClearCursorOnExhausted")]
    pub pool_clear_cursor_on_exhausted: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            auto_refresh_seconds: 600, // 10 分钟
            quota_alert_enabled: true,
            warn_percent: 80.0,
            critical_percent: 95.0,
            default_reset_machine_id: true,
            default_relaunch: true,
            shop_base_url: env_default_shop_url(),
            shop_jwt: None,
            shop_username: None,
            pool_auto_enabled: true,
            pool_swap_threshold_percent: 95.0,
            pool_clear_cursor_on_exhausted: true,
        }
    }
}

fn env_default_shop_url() -> String {
    std::env::var("POLO_SHOP_BASE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "https://shop.polo.example".into())
}

pub fn load(conn: &Connection) -> AppResult<AppSettings> {
    let mut s = AppSettings::default();
    if let Some(v) = get_raw(conn, "auto_refresh_seconds")? {
        if let Ok(n) = v.parse::<u64>() {
            s.auto_refresh_seconds = n;
        }
    }
    if let Some(v) = get_raw(conn, "quota_alert_enabled")? {
        s.quota_alert_enabled = v == "1";
    }
    if let Some(v) = get_raw(conn, "warn_percent")? {
        if let Ok(n) = v.parse::<f64>() {
            s.warn_percent = n;
        }
    }
    if let Some(v) = get_raw(conn, "critical_percent")? {
        if let Ok(n) = v.parse::<f64>() {
            s.critical_percent = n;
        }
    }
    if let Some(v) = get_raw(conn, "default_reset_machine_id")? {
        s.default_reset_machine_id = v == "1";
    }
    if let Some(v) = get_raw(conn, "default_relaunch")? {
        s.default_relaunch = v == "1";
    }
    if let Some(v) = get_raw(conn, "shop_base_url")? {
        if !v.trim().is_empty() {
            s.shop_base_url = v;
        }
    }
    s.shop_jwt = get_raw(conn, "shop_jwt")?.filter(|v| !v.is_empty());
    s.shop_username = get_raw(conn, "shop_username")?.filter(|v| !v.is_empty());
    if let Some(v) = get_raw(conn, "pool_auto_enabled")? {
        s.pool_auto_enabled = v == "1";
    }
    if let Some(v) = get_raw(conn, "pool_swap_threshold_percent")? {
        if let Ok(n) = v.parse::<f64>() {
            s.pool_swap_threshold_percent = n;
        }
    }
    if let Some(v) = get_raw(conn, "pool_clear_cursor_on_exhausted")? {
        s.pool_clear_cursor_on_exhausted = v == "1";
    }
    Ok(s)
}

pub fn save(conn: &Connection, s: &AppSettings) -> AppResult<()> {
    set_raw(conn, "auto_refresh_seconds", &s.auto_refresh_seconds.to_string())?;
    set_raw(conn, "quota_alert_enabled", if s.quota_alert_enabled { "1" } else { "0" })?;
    set_raw(conn, "warn_percent", &s.warn_percent.to_string())?;
    set_raw(conn, "critical_percent", &s.critical_percent.to_string())?;
    set_raw(
        conn,
        "default_reset_machine_id",
        if s.default_reset_machine_id { "1" } else { "0" },
    )?;
    set_raw(
        conn,
        "default_relaunch",
        if s.default_relaunch { "1" } else { "0" },
    )?;
    set_raw(conn, "shop_base_url", &s.shop_base_url)?;
    set_raw(conn, "shop_jwt", s.shop_jwt.as_deref().unwrap_or(""))?;
    set_raw(conn, "shop_username", s.shop_username.as_deref().unwrap_or(""))?;
    set_raw(conn, "pool_auto_enabled", if s.pool_auto_enabled { "1" } else { "0" })?;
    set_raw(
        conn,
        "pool_swap_threshold_percent",
        &s.pool_swap_threshold_percent.to_string(),
    )?;
    set_raw(
        conn,
        "pool_clear_cursor_on_exhausted",
        if s.pool_clear_cursor_on_exhausted { "1" } else { "0" },
    )?;
    Ok(())
}

fn get_raw(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let v: Option<String> = stmt.query_row([key], |r| r.get(0)).ok();
    Ok(v)
}

fn set_raw(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}
