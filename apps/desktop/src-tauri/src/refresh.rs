//! 后台自动刷新账号用量；阈值预警通过 Tauri event + 系统通知触发。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;
use tokio::time::sleep;

use crate::cursor::usage as usage_mod;
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
        // 写库
        if let Err(e) = store.with_conn(|c| accounts::save_usage(c, account.id, &usage)) {
            eprintln!("[refresh] save_usage {}: {e}", account.id);
            continue;
        }
        // 发更新事件
        let _ = app.emit(
            "usage-updated",
            UsageUpdateEvent {
                id: account.id,
                email: account.email.clone(),
                total_percent: usage.total_percent,
                remaining_usd: usage.remaining_usd,
            },
        );

        // 阈值预警
        if settings.quota_alert_enabled {
            if let Some(pct) = usage.total_percent {
                if pct >= settings.critical_percent {
                    notify_quota(app, &account, pct, "critical", usage.plan.as_deref());
                } else if pct >= settings.warn_percent {
                    notify_quota(app, &account, pct, "warn", usage.plan.as_deref());
                }
            }
        }
    }
    Ok(())
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

