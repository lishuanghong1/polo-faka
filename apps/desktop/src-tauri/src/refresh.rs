//! 后台自动刷新账号用量；阈值预警通过 Tauri event + 系统通知触发。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;
use tokio::time::sleep;

use crate::cursor::paths::CursorPaths;
use crate::cursor::process;
use crate::cursor::usage as usage_mod;
use crate::cursor::{state_vscdb, storage_json};
use crate::shop_api::{PoolGrantView, ShopApi};
use crate::store::accounts;
use crate::store::settings;
use crate::store::Store;

/// 一个轻量的后台刷新控制器：
/// - 保留一个 Notify 用来「外部通知间隔变更，立即唤醒重算」
/// - 通过 `AppHandle::state::<Store>` 在任务里取数据库
/// 实现策略：每次 sleep(interval)，醒来后扫一遍账号、查用量、emit 事件。
pub struct RefreshController {
    interval_notify: Arc<Notify>,
    interval_secs: AtomicU64,
}

impl RefreshController {
    pub fn new(initial_secs: u64) -> Self {
        Self {
            interval_notify: Arc::new(Notify::new()),
            interval_secs: AtomicU64::new(initial_secs),
        }
    }

    pub fn current_interval(&self) -> u64 {
        self.interval_secs.load(Ordering::Relaxed)
    }

    pub fn update_interval(&self, secs: u64) {
        self.interval_secs.store(secs, Ordering::Relaxed);
        self.interval_notify.notify_waiters();
    }

    pub fn notify(&self) -> Arc<Notify> {
        self.interval_notify.clone()
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct UsageUpdateEvent {
    pub id: i64,
    pub email: Option<String>,
    #[serde(rename = "totalPercent")]
    pub total_percent: Option<f64>,
    #[serde(rename = "remainingUsd")]
    pub remaining_usd: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct QuotaAlertEvent {
    pub id: i64,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub percent: f64,
    /// "warn" | "critical"
    pub level: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PoolSwappedEvent {
    #[serde(rename = "oldAccountId")]
    pub old_account_id: i64,
    #[serde(rename = "newEmail")]
    pub new_email: Option<String>,
    #[serde(rename = "orderNo")]
    pub order_no: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PoolExhaustedEvent {
    #[serde(rename = "accountId")]
    pub account_id: i64,
    #[serde(rename = "orderNo")]
    pub order_no: String,
    pub email: Option<String>,
    #[serde(rename = "clearedCursor")]
    pub cleared_cursor: bool,
}

/// 启动后台 task。永久循环，遵循 RefreshController 的 interval（0 = 跳过本轮）。
pub fn spawn(app: AppHandle, controller: Arc<RefreshController>) {
    tauri::async_runtime::spawn(async move {
        // notify_handle 的生命周期要覆盖整个 select!，不能内联调用
        let notify_handle = controller.notify();
        loop {
            let secs = controller.current_interval();
            // 0 = 关闭自动刷新，但保留任务以便后续在线变更
            if secs == 0 {
                notify_handle.notified().await;
                continue;
            }

            let notified = notify_handle.notified();
            tokio::pin!(notified);
            tokio::select! {
                _ = sleep(Duration::from_secs(secs)) => {}
                _ = &mut notified => {
                    // 间隔变了，直接重新计算
                    continue;
                }
            }

            // 跑一轮
            if let Err(e) = refresh_once(&app).await {
                eprintln!("[refresh] round failed: {e}");
            }
        }
    });
}

async fn refresh_once(app: &AppHandle) -> Result<(), String> {
    let store = app.state::<Store>();
    let list = store
        .with_conn(|c| accounts::list(c))
        .map_err(|e| e.to_string())?;
    if list.is_empty() {
        return Ok(());
    }
    let settings = store
        .with_conn(|c| settings::load(c))
        .map_err(|e| e.to_string())?;

    for account in list {
        let usage = match usage_mod::query(&account.access_token).await {
            Ok(u) => u,
            Err(e) => {
                eprintln!("[refresh] {} query failed: {e}", account.id);
                continue;
            }
        };
        if let Err(e) = store.with_conn(|c| accounts::save_usage(c, account.id, &usage)) {
            eprintln!("[refresh] save_usage {}: {e}", account.id);
            continue;
        }
        let _ = app.emit(
            "usage-updated",
            UsageUpdateEvent {
                id: account.id,
                email: account.email.clone(),
                total_percent: usage.total_percent,
                remaining_usd: usage.remaining_usd,
            },
        );

        if settings.quota_alert_enabled {
            if let Some(pct) = usage.total_percent {
                if pct >= settings.critical_percent {
                    notify_quota(app, &account, pct, "critical", usage.plan.as_deref());
                } else if pct >= settings.warn_percent {
                    notify_quota(app, &account, pct, "warn", usage.plan.as_deref());
                }
            }
        }

        // 号池绑定的账号：尝试自动换号 / 自动下机
        if account.pool_grant_order_no.is_some() && settings.pool_auto_enabled {
            if let Err(e) = handle_pool_account(app, &account, &usage, &settings).await {
                eprintln!("[refresh] pool handling {} failed: {e}", account.id);
            }
        }
    }
    Ok(())
}

/// 号池账号的自动调度逻辑（在 refresh 一轮里被调用）。
/// 触发条件：
///   - Cursor 用量 ≥ 阈值（默认 95%）且 Grant 仍有剩余 → swap
///   - Cursor 用量 ≥ 100% 或 Grant 已耗尽/过期 → release（+ 可选 logout）
async fn handle_pool_account(
    app: &AppHandle,
    account: &crate::store::accounts::Account,
    usage: &usage_mod::UsageInfo,
    settings: &crate::store::settings::AppSettings,
) -> Result<(), String> {
    let order_no = account
        .pool_grant_order_no
        .as_deref()
        .ok_or("no pool order")?;
    let store = app.state::<Store>();
    let api = ShopApi {
        base: &settings.shop_base_url,
        jwt: settings.shop_jwt.as_deref(),
    };

    // 先拉一次 grant 状态写回本地（让 UI 实时看到额度变化）
    let grant = match api.query_grant(order_no).await {
        Ok(g) => g,
        Err(e) => {
            // 401 等失败：清掉缓存 JWT，下次让用户重新登录
            eprintln!("[refresh] query_grant {order_no} failed: {e}");
            return Ok(());
        }
    };
    let _ = store.with_conn(|c| {
        accounts::save_pool_status(
            c,
            account.id,
            Some(grant.quota_total),
            Some(grant.quota_used),
            Some(grant.quota_remain),
            Some(grant.active),
        )
    });

    // 判定
    let cursor_pct = usage.total_percent.unwrap_or(0.0);
    let grant_exhausted = grant.quota_remain <= 0.0001;
    let cursor_exhausted = cursor_pct >= 100.0;
    let swap_threshold = settings.pool_swap_threshold_percent;
    let should_swap = !grant_exhausted
        && swap_threshold > 0.0
        && (cursor_pct >= swap_threshold || cursor_exhausted);

    if should_swap {
        // 调 swap → 拿到新 token → 写 Cursor
        match api.swap_account(order_no).await {
            Ok(swap_resp) if swap_resp.swapped => {
                if let Err(e) = apply_new_grant_to_cursor(
                    app,
                    account.id,
                    order_no,
                    &swap_resp.grant,
                    settings,
                )
                .await
                {
                    eprintln!("[refresh] auto-swap apply failed: {e}");
                    return Ok(());
                }
                let _ = app.emit(
                    "pool-swapped",
                    PoolSwappedEvent {
                        old_account_id: account.id,
                        new_email: swap_resp.grant.account.and_then(|a| a.email),
                        order_no: order_no.to_string(),
                    },
                );
                notify_simple(
                    app,
                    "号池自动换号成功",
                    &format!(
                        "{} 用量到 {:.1}%，已自动换号 → {}",
                        account.email.as_deref().unwrap_or("(未识别)"),
                        cursor_pct,
                        order_no
                    ),
                );
                return Ok(());
            }
            Ok(swap_resp) => {
                // 没换成（额度耗尽）→ 走 release 路径
                grant_finish(app, account, order_no, settings, &swap_resp.grant)
                    .await
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
            Err(e) => {
                eprintln!("[refresh] swap_account failed: {e}");
                return Ok(());
            }
        }
    }

    if grant_exhausted || cursor_exhausted {
        grant_finish(app, account, order_no, settings, &grant)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn grant_finish(
    app: &AppHandle,
    account: &crate::store::accounts::Account,
    order_no: &str,
    settings: &crate::store::settings::AppSettings,
    grant: &PoolGrantView,
) -> crate::error::AppResult<()> {
    let store = app.state::<Store>();
    let api = ShopApi {
        base: &settings.shop_base_url,
        jwt: settings.shop_jwt.as_deref(),
    };
    // 释放号
    if grant.account.is_some() {
        let _ = api.release_account(order_no).await;
    }
    // 清掉本地账号库的 pool 绑定
    let _ = store.with_conn(|c| accounts::clear_pool_binding(c, account.id));

    // 可选：清 Cursor 登录态
    let mut cleared = false;
    if settings.pool_clear_cursor_on_exhausted {
        if let Err(e) = clear_cursor_login() {
            eprintln!("[refresh] clear_cursor_login failed: {e}");
        } else {
            cleared = true;
        }
    }
    let _ = app.emit(
        "pool-exhausted",
        PoolExhaustedEvent {
            account_id: account.id,
            order_no: order_no.to_string(),
            email: account.email.clone(),
            cleared_cursor: cleared,
        },
    );
    notify_simple(
        app,
        "号池额度已用完",
        &format!(
            "{} 额度耗尽，{}",
            account.email.as_deref().unwrap_or("(未识别)"),
            if cleared {
                "已释放号 + 清空 Cursor 登录"
            } else {
                "已释放号"
            }
        ),
    );
    Ok(())
}

/// 把 swap 拿到的新 grant 应用到 Cursor：
/// - 写入 storage.json + state.vscdb
/// - 重启 Cursor
/// - 更新账号库：旧 account 解绑、新 token 入库并绑定到同一 orderNo
async fn apply_new_grant_to_cursor(
    app: &AppHandle,
    old_account_id: i64,
    order_no: &str,
    grant: &PoolGrantView,
    settings: &crate::store::settings::AppSettings,
) -> crate::error::AppResult<()> {
    let store = app.state::<Store>();
    let account_view = grant
        .account
        .as_ref()
        .ok_or_else(|| crate::error::AppError::Other("swap 未返回 account".into()))?;
    let token = account_view
        .token
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| crate::error::AppError::Other("swap 未返回 token".into()))?;
    let email = account_view.email.as_deref().unwrap_or("");

    // 写 Cursor（用 import_account_inner 的核心步骤）
    let raw = if email.is_empty() {
        token.to_string()
    } else {
        format!("{email}----{token}")
    };
    crate::commands::account::import_account_inner(crate::commands::account::ImportPayload {
        raw,
        reset_machine_id: settings.default_reset_machine_id,
        kill_and_relaunch: settings.default_relaunch,
    })
    .await?;

    // 旧 account 的 pool 绑定清掉
    let _ = store.with_conn(|c| accounts::clear_pool_binding(c, old_account_id));

    // 新 account 入库
    let user_id = usage_mod::extract_user_id(token);
    let order_no_owned = order_no.to_string();
    let _ = store.with_conn(|c| {
        let acc = accounts::upsert(
            c,
            accounts::NewAccount {
                email: if email.is_empty() { None } else { Some(email) },
                access_token: token,
                refresh_token: Some(token),
                user_id: user_id.as_deref(),
                label: Some("号池"),
                pool_grant_order_no: Some(&order_no_owned),
            },
        )?;
        accounts::save_pool_status(
            c,
            acc.id,
            Some(grant.quota_total),
            Some(grant.quota_used),
            Some(grant.quota_remain),
            Some(grant.active),
        )?;
        accounts::mark_used(c, acc.id)?;
        Ok::<_, crate::error::AppError>(())
    });
    Ok(())
}

/// 清空 Cursor 本机登录态：和 commands::pool::cursor_logout 等效，但内部用
fn clear_cursor_login() -> crate::error::AppResult<()> {
    let paths = CursorPaths::detect()?;
    if !paths.is_installed() {
        return Ok(());
    }
    if process::is_running() {
        let _ = process::kill_all();
    }
    let backup_dir = CursorPaths::new_backup_dir()?;
    let _ = storage_json::backup(&paths.storage_json, &backup_dir);
    let _ = state_vscdb::backup(&paths.state_db, &backup_dir);
    storage_json::ensure_exists(&paths.storage_json)?;
    let mut root = storage_json::read_or_empty(&paths.storage_json);
    for k in [
        "cursorAuth.accessToken",
        "cursorAuth.refreshToken",
        "cursorAuth.cachedEmail",
        "cursorAuth.cachedSignUpType",
        "cursorAuth.stripeMembershipType",
    ] {
        storage_json::set_dotted(&mut root, k, serde_json::Value::String(String::new()));
    }
    storage_json::write_atomic(&paths.storage_json, &root)?;
    state_vscdb::upsert_all(
        &paths.state_db,
        [
            ("cursorAuth/accessToken", ""),
            ("cursorAuth/refreshToken", ""),
            ("cursorAuth/cachedEmail", ""),
        ],
    )?;
    Ok(())
}

fn notify_simple(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

fn notify_quota(
    app: &AppHandle,
    account: &crate::store::accounts::Account,
    percent: f64,
    level: &str,
    plan: Option<&str>,
) {
    let email_label = account.email.as_deref().unwrap_or("（未识别 email）");
    let plan_label = plan.unwrap_or("");
    let (title, body) = if level == "critical" {
        (
            "Cursor 配额告急",
            format!(
                "{email_label} {plan_label} 已使用 {:.1}%，接近上限",
                percent
            ),
        )
    } else {
        (
            "Cursor 配额警告",
            format!(
                "{email_label} {plan_label} 已使用 {:.1}%，建议留意",
                percent
            ),
        )
    };

    // 系统通知（用户可能关了，失败就忽略）
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(&body)
        .show();

    // 同时 emit 事件，UI 也能弹横幅
    let _ = app.emit(
        "quota-alert",
        QuotaAlertEvent {
            id: account.id,
            email: account.email.clone(),
            plan: plan.map(|s| s.to_string()),
            percent,
            level: level.into(),
        },
    );
}

