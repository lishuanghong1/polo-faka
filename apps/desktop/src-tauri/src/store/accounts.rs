//! 本地账号库：把每次「导入」过的账号缓存到 SQLite，便于后续切换、用量追踪。

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::cursor::usage::UsageInfo;
use crate::error::{AppError, AppResult};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    access_token TEXT NOT NULL UNIQUE,
    refresh_token TEXT,
    user_id TEXT,
    label TEXT,
    tags_json TEXT,                       -- JSON 数组：["热门","质保7天",...]
    -- 用量快照
    plan TEXT,
    included_spend_usd REAL,
    limit_usd REAL,
    remaining_usd REAL,
    total_percent REAL,
    auto_percent REAL,
    api_percent REAL,
    period_start TEXT,
    period_end TEXT,
    usage_source TEXT,
    last_usage_at INTEGER,                -- unix 秒
    -- 元数据
    created_at INTEGER NOT NULL,
    last_used_at INTEGER                  -- 最后被切换到 Cursor 的时间
);

CREATE INDEX IF NOT EXISTS idx_accounts_last_used ON accounts(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
"#;

/// SQLite 没有 IF NOT EXISTS for columns，得手动判断
fn add_column_if_missing(conn: &Connection, col: &str, def: &str) -> AppResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(accounts)")?;
    let has = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|name| name == col);
    if !has {
        conn.execute(&format!("ALTER TABLE accounts ADD COLUMN {col} {def}"), [])?;
    }
    Ok(())
}

pub fn ensure_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(SCHEMA)?;
    // 号池绑定字段：标识本地 account 实际是某个号池 Grant 申请下来的，
    // refresh 任务遇到这种 account 会按号池阈值规则自动换号/释放
    add_column_if_missing(conn, "pool_grant_order_no", "TEXT")?;
    add_column_if_missing(conn, "pool_quota_total", "REAL")?;
    add_column_if_missing(conn, "pool_quota_used", "REAL")?;
    add_column_if_missing(conn, "pool_quota_remain", "REAL")?;
    add_column_if_missing(conn, "pool_grant_active", "INTEGER")?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub email: Option<String>,
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    pub label: Option<String>,
    pub tags: Vec<String>,

    pub plan: Option<String>,
    #[serde(rename = "includedSpendUsd")]
    pub included_spend_usd: Option<f64>,
    #[serde(rename = "limitUsd")]
    pub limit_usd: Option<f64>,
    #[serde(rename = "remainingUsd")]
    pub remaining_usd: Option<f64>,
    #[serde(rename = "totalPercent")]
    pub total_percent: Option<f64>,
    #[serde(rename = "autoPercent")]
    pub auto_percent: Option<f64>,
    #[serde(rename = "apiPercent")]
    pub api_percent: Option<f64>,
    #[serde(rename = "periodStart")]
    pub period_start: Option<String>,
    #[serde(rename = "periodEnd")]
    pub period_end: Option<String>,
    #[serde(rename = "usageSource")]
    pub usage_source: Option<String>,
    #[serde(rename = "lastUsageAt")]
    pub last_usage_at: Option<i64>,

    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "lastUsedAt")]
    pub last_used_at: Option<i64>,

    // ── 号池绑定（来自商城后端的 Grant）─────────────
    /// 如果此账号是通过号池申请来的，记录对应 PoolGrant 的 orderNo
    #[serde(rename = "poolGrantOrderNo")]
    pub pool_grant_order_no: Option<String>,
    #[serde(rename = "poolQuotaTotal")]
    pub pool_quota_total: Option<f64>,
    #[serde(rename = "poolQuotaUsed")]
    pub pool_quota_used: Option<f64>,
    #[serde(rename = "poolQuotaRemain")]
    pub pool_quota_remain: Option<f64>,
    #[serde(rename = "poolGrantActive")]
    pub pool_grant_active: Option<bool>,
}

fn parse_tags(s: Option<String>) -> Vec<String> {
    s.and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

fn row_to_account(row: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        email: row.get(1)?,
        access_token: row.get(2)?,
        refresh_token: row.get(3)?,
        user_id: row.get(4)?,
        label: row.get(5)?,
        tags: parse_tags(row.get(6)?),
        plan: row.get(7)?,
        included_spend_usd: row.get(8)?,
        limit_usd: row.get(9)?,
        remaining_usd: row.get(10)?,
        total_percent: row.get(11)?,
        auto_percent: row.get(12)?,
        api_percent: row.get(13)?,
        period_start: row.get(14)?,
        period_end: row.get(15)?,
        usage_source: row.get(16)?,
        last_usage_at: row.get(17)?,
        created_at: row.get(18)?,
        last_used_at: row.get(19)?,
        pool_grant_order_no: row.get(20)?,
        pool_quota_total: row.get(21)?,
        pool_quota_used: row.get(22)?,
        pool_quota_remain: row.get(23)?,
        pool_grant_active: row.get::<_, Option<i64>>(24)?.map(|v| v != 0),
    })
}

const SELECT_COLS: &str = "id, email, access_token, refresh_token, user_id, label, tags_json, \
    plan, included_spend_usd, limit_usd, remaining_usd, total_percent, auto_percent, api_percent, \
    period_start, period_end, usage_source, last_usage_at, created_at, last_used_at, \
    pool_grant_order_no, pool_quota_total, pool_quota_used, pool_quota_remain, pool_grant_active";

pub fn list(conn: &Connection) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM accounts ORDER BY last_used_at DESC NULLS LAST, id DESC"
    ))?;
    let rows = stmt
        .query_map([], row_to_account)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Account> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM accounts WHERE id = ?1"
    ))?;
    let acc = stmt
        .query_row([id], row_to_account)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::Other("账号不存在".into()),
            _ => e.into(),
        })?;
    Ok(acc)
}

pub fn find_by_token(conn: &Connection, token: &str) -> AppResult<Option<Account>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM accounts WHERE access_token = ?1"
    ))?;
    let acc = stmt.query_row([token], row_to_account).ok();
    Ok(acc)
}

/// 新建参数；email/refresh/user_id 都可能没有
pub struct NewAccount<'a> {
    pub email: Option<&'a str>,
    pub access_token: &'a str,
    pub refresh_token: Option<&'a str>,
    pub user_id: Option<&'a str>,
    pub label: Option<&'a str>,
    /// 号池来源 orderNo（None = 不是号池账号）
    pub pool_grant_order_no: Option<&'a str>,
}

/// 已存在则更新基础字段（email/refresh/user_id/label/pool_grant_order_no）+ 返回，否则插入
pub fn upsert(conn: &Connection, n: NewAccount) -> AppResult<Account> {
    if let Some(existing) = find_by_token(conn, n.access_token)? {
        // 合并 email / refresh / user_id（取非空覆盖）
        conn.execute(
            r#"UPDATE accounts SET
                email = COALESCE(?1, email),
                refresh_token = COALESCE(?2, refresh_token),
                user_id = COALESCE(?3, user_id),
                label = COALESCE(?4, label),
                pool_grant_order_no = COALESCE(?5, pool_grant_order_no)
               WHERE id = ?6"#,
            params![
                n.email,
                n.refresh_token,
                n.user_id,
                n.label,
                n.pool_grant_order_no,
                existing.id
            ],
        )?;
        return get(conn, existing.id);
    }
    let now = now_secs();
    conn.execute(
        r#"INSERT INTO accounts(email, access_token, refresh_token, user_id, label,
                pool_grant_order_no, created_at)
            VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
        params![
            n.email,
            n.access_token,
            n.refresh_token,
            n.user_id,
            n.label,
            n.pool_grant_order_no,
            now
        ],
    )?;
    let id = conn.last_insert_rowid();
    get(conn, id)
}

/// 把号池 Grant 的元数据更新到本地账号（refresh 用）
pub fn save_pool_status(
    conn: &Connection,
    id: i64,
    quota_total: Option<f64>,
    quota_used: Option<f64>,
    quota_remain: Option<f64>,
    active: Option<bool>,
) -> AppResult<()> {
    conn.execute(
        r#"UPDATE accounts SET
            pool_quota_total = ?1,
            pool_quota_used = ?2,
            pool_quota_remain = ?3,
            pool_grant_active = ?4
           WHERE id = ?5"#,
        params![
            quota_total,
            quota_used,
            quota_remain,
            active.map(|v| if v { 1i64 } else { 0i64 }),
            id
        ],
    )?;
    Ok(())
}

/// 解绑：清空 pool 字段（号池账号被释放/换号后调用）
pub fn clear_pool_binding(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        r#"UPDATE accounts SET
            pool_grant_order_no = NULL,
            pool_quota_total = NULL,
            pool_quota_used = NULL,
            pool_quota_remain = NULL,
            pool_grant_active = NULL
           WHERE id = ?1"#,
        [id],
    )?;
    Ok(())
}

/// 查所有还绑定着号池的账号（refresh 任务自动调度的目标集合）
pub fn list_with_pool_binding(conn: &Connection) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM accounts WHERE pool_grant_order_no IS NOT NULL"
    ))?;
    let rows = stmt
        .query_map([], row_to_account)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let n = conn.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::Other("账号不存在".into()));
    }
    Ok(())
}

pub fn update_label(
    conn: &Connection,
    id: i64,
    label: Option<&str>,
    tags: Option<&[String]>,
) -> AppResult<Account> {
    let tags_json = tags.map(|t| serde_json::to_string(t).unwrap_or_default());
    conn.execute(
        "UPDATE accounts SET label = ?1, tags_json = COALESCE(?2, tags_json) WHERE id = ?3",
        params![label, tags_json, id],
    )?;
    get(conn, id)
}

pub fn mark_used(conn: &Connection, id: i64) -> AppResult<()> {
    let now = now_secs();
    conn.execute(
        "UPDATE accounts SET last_used_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

/// 把查到的用量数据写回账号行（不改 token 等字段）
pub fn save_usage(conn: &Connection, id: i64, usage: &UsageInfo) -> AppResult<()> {
    let now = now_secs();
    conn.execute(
        r#"UPDATE accounts SET
            plan = ?1,
            included_spend_usd = ?2,
            limit_usd = ?3,
            remaining_usd = ?4,
            total_percent = ?5,
            auto_percent = ?6,
            api_percent = ?7,
            period_start = ?8,
            period_end = ?9,
            usage_source = ?10,
            last_usage_at = ?11,
            user_id = COALESCE(?12, user_id)
           WHERE id = ?13"#,
        params![
            usage.plan,
            usage.included_spend_usd,
            usage.limit_usd,
            usage.remaining_usd,
            usage.total_percent,
            usage.auto_percent,
            usage.api_percent,
            usage.period_start,
            usage.period_end,
            usage.source,
            now,
            usage.user_id,
            id,
        ],
    )?;
    Ok(())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
