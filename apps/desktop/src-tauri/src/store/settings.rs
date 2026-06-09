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
        }
    }
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
