//! 号池相关命令：与商城后端交互 + 把申请到的号写入 Cursor。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::account::{import_account_inner, ImportPayload};
use crate::cursor::{paths::CursorPaths, process, state_vscdb, storage_json, usage as usage_mod};
use crate::error::{AppError, AppResult};
use crate::shop_api::{PoolGrantView, ShopApi, SwapResponse};
use crate::store::accounts::{self, NewAccount};
use crate::store::settings::{self, AppSettings};
use crate::store::Store;

fn shop_api<'a>(s: &'a AppSettings) -> AppResult<ShopApi<'a>> {
    if s.shop_base_url.trim().is_empty() {
        return Err(AppError::Other("尚未配置商城地址".into()));
    }
    Ok(ShopApi {
        base: &s.shop_base_url,
        jwt: s.shop_jwt.as_deref(),
    })
}

fn shop_api_no_jwt<'a>(s: &'a AppSettings) -> AppResult<ShopApi<'a>> {
    Ok(ShopApi {
        base: &s.shop_base_url,
        jwt: None,
    })
}

// ────────────── 登录态 ──────────────

#[derive(Debug, Serialize)]
pub struct CaptchaInfo {
    pub id: String,
    pub svg: String,
    #[serde(rename = "expiresIn")]
    pub expires_in: u64,
}

#[tauri::command]
pub async fn shop_get_captcha(store: State<'_, Store>) -> AppResult<CaptchaInfo> {
    let settings_loaded = store.with_conn(|c| settings::load(c))?;
    let api = shop_api_no_jwt(&settings_loaded)?;
    let r = api.captcha().await?;
    Ok(CaptchaInfo {
        id: r.id,
        svg: r.svg,
        expires_in: r.expires_in,
    })
}

#[derive(Debug, Deserialize)]
pub struct LoginPayload {
    pub username: String,
    pub password: String,
    #[serde(rename = "captchaId")]
    pub captcha_id: String,
    #[serde(rename = "captchaCode")]
    pub captcha_code: String,
}

#[derive(Debug, Serialize)]
pub struct ShopProfile {
    pub username: Option<String>,
    pub email: Option<String>,
    pub nickname: Option<String>,
}

#[tauri::command]
pub async fn shop_login(
    store: State<'_, Store>,
    payload: LoginPayload,
) -> AppResult<ShopProfile> {
    let mut settings_loaded = store.with_conn(|c| settings::load(c))?;
    let api = shop_api_no_jwt(&settings_loaded)?;
    let resp = api
        .login(
            &payload.username,
            &payload.password,
            &payload.captcha_id,
            &payload.captcha_code,
        )
        .await?;
    let profile = ShopProfile {
        username: resp
            .user
            .get("username")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| Some(payload.username.clone())),
        email: resp
            .user
            .get("email")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        nickname: resp
            .user
            .get("nickname")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };
    settings_loaded.shop_jwt = Some(resp.token);
    settings_loaded.shop_username = profile.username.clone();
    store.with_conn(|c| settings::save(c, &settings_loaded))?;
    Ok(profile)
}

#[tauri::command]
pub fn shop_logout(store: State<'_, Store>) -> AppResult<()> {
    let mut settings_loaded = store.with_conn(|c| settings::load(c))?;
    settings_loaded.shop_jwt = None;
    settings_loaded.shop_username = None;
    store.with_conn(|c| settings::save(c, &settings_loaded))?;
    Ok(())
}

// ────────────── 号池操作 ──────────────

#[tauri::command]
pub async fn pool_list_my_grants(store: State<'_, Store>) -> AppResult<Vec<PoolGrantView>> {
    let s = store.with_conn(|c| settings::load(c))?;
    require_jwt(&s)?;
    let api = shop_api(&s)?;
    api.list_my_grants().await
}

#[derive(Debug, Deserialize)]
pub struct PoolApplyOptions {
    /// 是否在拿到 token 后立即写入 Cursor 并重启
    #[serde(rename = "writeToCursor", default = "default_true")]
    pub write_to_cursor: bool,
    #[serde(rename = "resetMachineId", default)]
    pub reset_machine_id: bool,
    #[serde(rename = "killAndRelaunch", default = "default_true")]
    pub kill_and_relaunch: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct PoolApplyResult {
    pub grant: PoolGrantView,
    /// 是否真的写入了 Cursor
    #[serde(rename = "wroteToCursor")]
    pub wrote_to_cursor: bool,
    /// 写入后的本地 account id（便于联动账号库高亮）
    #[serde(rename = "accountId")]
    pub account_id: Option<i64>,
}

#[tauri::command]
pub async fn pool_claim(
    store: State<'_, Store>,
    order_no: String,
    options: PoolApplyOptions,
) -> AppResult<PoolApplyResult> {
    let s = store.with_conn(|c| settings::load(c))?;
    require_jwt(&s)?;
    let api = shop_api(&s)?;
    let grant = api.claim_account(&order_no).await?;
    apply_grant_to_cursor(&store, &order_no, grant, &options).await
}

#[tauri::command]
pub async fn pool_swap(
    store: State<'_, Store>,
    order_no: String,
    options: PoolApplyOptions,
) -> AppResult<PoolApplyResult> {
    let s = store.with_conn(|c| settings::load(c))?;
    require_jwt(&s)?;
    let api = shop_api(&s)?;
    let SwapResponse {
        swapped,
        exhausted,
        expired,
        grant,
    } = api.swap_account(&order_no).await?;
    if !swapped {
        // 没换成（额度耗尽 / 过期）→ 只是回报当前 grant；不写 Cursor
        let _ = exhausted; // 留给上层处理
        let _ = expired;
        return Ok(PoolApplyResult {
            grant,
            wrote_to_cursor: false,
            account_id: None,
        });
    }
    apply_grant_to_cursor(&store, &order_no, grant, &options).await
}

#[tauri::command]
pub async fn pool_release(
    store: State<'_, Store>,
    order_no: String,
) -> AppResult<PoolGrantView> {
    let s = store.with_conn(|c| settings::load(c))?;
    require_jwt(&s)?;
    let api = shop_api(&s)?;
    let grant = api.release_account(&order_no).await?;
    // 清掉本地账号库里此 order 的绑定（不删账号本身，留作历史）
    let _ = store.with_conn(|c| {
        let list = accounts::list_with_pool_binding(c)?;
        for a in list {
            if a.pool_grant_order_no.as_deref() == Some(&order_no) {
                accounts::clear_pool_binding(c, a.id)?;
            }
        }
        Ok::<_, AppError>(())
    });
    Ok(grant)
}

/// 把 Cursor 的本机登录信息整体清掉（用于「额度用尽自动下机」）。
/// 实现：清 storage.json 里 cursorAuth.* 字段 + 删 state.vscdb 中对应 key + 可选关 Cursor。
#[tauri::command]
pub async fn cursor_logout(kill: bool) -> AppResult<bool> {
    let paths = CursorPaths::detect()?;
    if !paths.is_installed() {
        return Err(AppError::CursorNotFound);
    }
    if kill && process::is_running() {
        process::kill_all()?;
    }
    // 备份
    let backup_dir = CursorPaths::new_backup_dir()?;
    storage_json::backup(&paths.storage_json, &backup_dir)?;
    state_vscdb::backup(&paths.state_db, &backup_dir)?;

    // storage.json：把账户字段置空
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

    // state.vscdb：写空串覆盖
    state_vscdb::upsert_all(
        &paths.state_db,
        [
            ("cursorAuth/accessToken", ""),
            ("cursorAuth/refreshToken", ""),
            ("cursorAuth/cachedEmail", ""),
        ],
    )?;
    Ok(true)
}

// ────────────── 辅助函数 ──────────────

fn require_jwt(s: &AppSettings) -> AppResult<()> {
    if s.shop_jwt.as_deref().filter(|j| !j.is_empty()).is_none() {
        return Err(AppError::Other("尚未登录商城账号".into()));
    }
    Ok(())
}

/// 把 grant 里返回的 token 写入 Cursor、入库、做账号库 pool 绑定
async fn apply_grant_to_cursor(
    store: &State<'_, Store>,
    order_no: &str,
    grant: PoolGrantView,
    options: &PoolApplyOptions,
) -> AppResult<PoolApplyResult> {
    let mut result = PoolApplyResult {
        grant: grant.clone(),
        wrote_to_cursor: false,
        account_id: None,
    };

    let account_view = grant.account.as_ref();
    let token = account_view.and_then(|a| a.token.as_deref()).unwrap_or("");
    if token.is_empty() {
        return Err(AppError::Other("申请失败：未拿到账号 token".into()));
    }
    let email = account_view.and_then(|a| a.email.as_deref()).unwrap_or("");
    let raw = if email.is_empty() {
        token.to_string()
    } else {
        format!("{email}----{token}")
    };

    if options.write_to_cursor {
        let import_result = import_account_inner(ImportPayload {
            raw: raw.clone(),
            reset_machine_id: options.reset_machine_id,
            kill_and_relaunch: options.kill_and_relaunch,
        })
        .await?;
        result.wrote_to_cursor = true;
        let _ = import_result;
    }

    // 入库（带上 pool 绑定）
    let user_id = usage_mod::extract_user_id(token);
    let order_no_owned = order_no.to_string();
    let inserted = store.with_conn(|c| {
        let acc = accounts::upsert(
            c,
            NewAccount {
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
        Ok::<_, AppError>(acc)
    })?;
    result.account_id = Some(inserted.id);
    Ok(result)
}
