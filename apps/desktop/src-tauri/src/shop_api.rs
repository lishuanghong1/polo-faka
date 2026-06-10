//! 商城后端 HTTP 客户端（用于号池联动）。
//!
//! 所有方法都用「base url + JWT」调用现成的商城接口：
//!   - POST /website-auth/login + GET /captcha
//!   - GET  /pool/grants/mine
//!   - POST /pool/grants/:orderNo/claim-account
//!   - POST /pool/grants/:orderNo/release-account
//!   - POST /pool/grants/:orderNo/swap-account

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PoloAccountTool/0.1 ShopClient";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptchaResponse {
    pub id: String,
    pub svg: String,
    #[serde(rename = "expiresIn")]
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolAccountView {
    pub id: i64,
    pub email: Option<String>,
    /// 申请/换号时这里有明文 token；普通查询会被打码或为空
    pub token: Option<String>,
    #[serde(rename = "tokenMasked", default)]
    pub token_masked: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PoolGrantView {
    /// 未发放时 id 可能为 null
    pub id: Option<i64>,
    #[serde(rename = "orderNo")]
    pub order_no: String,
    #[serde(rename = "orderTitle", default)]
    pub order_title: Option<String>,
    #[serde(rename = "quotaTotal", default)]
    pub quota_total: f64,
    #[serde(rename = "quotaUsed", default)]
    pub quota_used: f64,
    #[serde(rename = "quotaRemain", default)]
    pub quota_remain: f64,
    #[serde(default)]
    pub active: bool,
    #[serde(rename = "endAt")]
    pub end_at: Option<String>,
    #[serde(rename = "lastCheckAt")]
    pub last_check_at: Option<String>,
    pub account: Option<PoolAccountView>,
    #[serde(rename = "notProvisioned", default)]
    pub not_provisioned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapResponse {
    #[serde(default)]
    pub swapped: bool,
    #[serde(default)]
    pub exhausted: bool,
    #[serde(default)]
    pub expired: bool,
    pub grant: PoolGrantView,
}

pub struct ShopApi<'a> {
    pub base: &'a str,
    pub jwt: Option<&'a str>,
}

/// 商城 Nest API 统一前缀；用户填域名时自动补上 `/api`
fn normalize_base(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.is_empty() {
        return String::new();
    }
    if b.ends_with("/api") {
        b.to_string()
    } else {
        format!("{b}/api")
    }
}

impl<'a> ShopApi<'a> {
    fn url(&self, path: &str) -> String {
        format!("{}{}", normalize_base(self.base), path)
    }

    fn client() -> AppResult<reqwest::Client> {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| AppError::Other(format!("HTTP 客户端构建失败：{e}")))
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> AppResult<T> {
        let req = Self::client()?.get(self.url(path));
        let req = match self.jwt {
            Some(jwt) => req.header("Authorization", format!("Bearer {jwt}")),
            None => req,
        };
        let resp = req
            .send()
            .await
            .map_err(|e| AppError::Other(format!("商城接口请求失败：{e}")))?;
        Self::parse::<T>(resp).await
    }

    async fn post_json<T: serde::de::DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> AppResult<T> {
        let req = Self::client()?.post(self.url(path)).json(body);
        let req = match self.jwt {
            Some(jwt) => req.header("Authorization", format!("Bearer {jwt}")),
            None => req,
        };
        let resp = req
            .send()
            .await
            .map_err(|e| AppError::Other(format!("商城接口请求失败：{e}")))?;
        Self::parse::<T>(resp).await
    }

    async fn parse<T: serde::de::DeserializeOwned>(resp: reqwest::Response) -> AppResult<T> {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| AppError::Other(format!("读取商城响应失败：{e}")))?;

        #[derive(Deserialize)]
        struct ApiEnvelope {
            success: Option<bool>,
            data: Option<Value>,
            error: Option<String>,
        }

        if let Ok(env) = serde_json::from_str::<ApiEnvelope>(&text) {
            if env.success == Some(false) {
                return Err(AppError::Other(
                    env.error.unwrap_or_else(|| "请求失败".into()),
                ));
            }
            if let Some(data) = env.data {
                if data.is_null() {
                    return Err(AppError::Other("商城接口返回 data 为空".into()));
                }
                return serde_json::from_value(data).map_err(|e| {
                    AppError::Other(format!("商城接口响应解析失败：{e}"))
                });
            }
        }

        if !status.is_success() {
            let msg = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| {
                    v.get("error")
                        .or_else(|| v.pointer("/error/message"))
                        .or_else(|| v.get("message"))
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| format!("HTTP {status}"));
            return Err(AppError::Other(msg));
        }

        // 兼容未封装的直出 JSON
        serde_json::from_str(&text).map_err(|e| {
            let preview: String = text.chars().take(160).collect();
            AppError::Other(format!(
                "商城接口响应解析失败：{e}（请确认商城地址可访问；片段：{preview}）"
            ))
        })
    }

    // ────────────── 公开接口 ──────────────

    pub async fn captcha(&self) -> AppResult<CaptchaResponse> {
        self.get_json("/captcha").await
    }

    pub async fn login(
        &self,
        username: &str,
        password: &str,
        captcha_id: &str,
        captcha_code: &str,
    ) -> AppResult<LoginResponse> {
        #[derive(Serialize)]
        struct Body<'a> {
            username: &'a str,
            password: &'a str,
            #[serde(rename = "captchaId")]
            captcha_id: &'a str,
            #[serde(rename = "captchaCode")]
            captcha_code: &'a str,
        }
        self.post_json(
            "/website-auth/login",
            &Body {
                username,
                password,
                captcha_id,
                captcha_code,
            },
        )
        .await
    }

    pub async fn profile(&self) -> AppResult<Value> {
        self.get_json("/website-auth/profile").await
    }

    // ────────────── 号池接口（需 JWT）──────────────

    pub async fn list_my_grants(&self) -> AppResult<Vec<PoolGrantView>> {
        let req = Self::client()?.get(self.url("/pool/grants/mine"));
        let req = match self.jwt {
            Some(jwt) => req.header("Authorization", format!("Bearer {jwt}")),
            None => req,
        };
        let resp = req
            .send()
            .await
            .map_err(|e| AppError::Other(format!("商城接口请求失败：{e}")))?;

        // 旧版商城未部署 grants/mine，回退到 orders/mine + 逐单查 grant
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return self.list_my_grants_via_orders().await;
        }
        Self::parse::<Vec<PoolGrantView>>(resp).await
    }

    /// 兼容旧商城：从「我的订单」只取 POOL_QUOTA，再逐个查 grant
    async fn list_my_grants_via_orders(&self) -> AppResult<Vec<PoolGrantView>> {
        let mut grants = Vec::new();
        let mut page = 1u64;
        let page_size = 50u64;

        loop {
            let path = format!("/orders/mine?page={page}&pageSize={page_size}");
            let page_data: OrdersMinePage = self.get_json(&path).await?;
            for order in &page_data.items {
                if !order.is_pool_quota_order() {
                    continue;
                }
                let title = order.display_title();
                match self.query_grant(&order.order_no).await {
                    Ok(mut grant) => {
                        if grant.order_title.is_none() {
                            grant.order_title = Some(title);
                        }
                        grant.not_provisioned = false;
                        grants.push(grant);
                    }
                    Err(_) if order.delivery_type.is_some() => {
                        // 已确认是额度包但 Grant 尚未创建
                        grants.push(PoolGrantView {
                            order_no: order.order_no.clone(),
                            order_title: Some(title),
                            not_provisioned: true,
                            ..PoolGrantView::default()
                        });
                    }
                    Err(_) => {
                        // 旧接口无 deliveryType：查不到 grant 则跳过，避免混入普通订单
                    }
                }
            }
            if page * page_size >= page_data.total.max(1) {
                break;
            }
            page += 1;
        }

        Ok(grants)
    }

    pub async fn claim_account(&self, order_no: &str) -> AppResult<PoolGrantView> {
        let path = format!("/pool/grants/{}/claim-account", urlencode(order_no));
        self.post_json::<PoolGrantView, _>(&path, &serde_json::json!({}))
            .await
    }

    pub async fn release_account(&self, order_no: &str) -> AppResult<PoolGrantView> {
        let path = format!("/pool/grants/{}/release-account", urlencode(order_no));
        self.post_json::<PoolGrantView, _>(&path, &serde_json::json!({}))
            .await
    }

    pub async fn swap_account(&self, order_no: &str) -> AppResult<SwapResponse> {
        let path = format!("/pool/grants/{}/swap-account", urlencode(order_no));
        self.post_json::<SwapResponse, _>(&path, &serde_json::json!({}))
            .await
    }

    pub async fn query_grant(&self, order_no: &str) -> AppResult<PoolGrantView> {
        let path = format!("/pool/grants/{}", urlencode(order_no));
        self.get_json(&path).await
    }
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[derive(Debug, Deserialize)]
struct OrdersMinePage {
    total: u64,
    items: Vec<OrderMineItem>,
}

#[derive(Debug, Deserialize)]
struct OrderMineItem {
    #[serde(rename = "orderNo")]
    order_no: String,
    status: String,
    #[serde(rename = "deliveryType", default)]
    delivery_type: Option<String>,
    #[serde(rename = "productTitle", default)]
    product_title: Option<String>,
    #[serde(rename = "skuName", default)]
    sku_name: Option<String>,
    #[serde(rename = "cardKeys", default)]
    card_keys: Vec<serde_json::Value>,
}

impl OrderMineItem {
    fn is_pool_quota_order(&self) -> bool {
        if !matches!(self.status.as_str(), "PAID" | "DELIVERED") {
            return false;
        }
        match self.delivery_type.as_deref() {
            Some("POOL_QUOTA") => true,
            Some(_) => false,
            // 旧商城无 deliveryType：先当候选，是否额度包由 query_grant 结果决定
            None => self.card_keys.is_empty(),
        }
    }

    fn display_title(&self) -> String {
        match (&self.product_title, &self.sku_name) {
            (Some(p), Some(s)) if !s.is_empty() => format!("{p} · {s}"),
            (Some(p), _) => p.clone(),
            _ => self.order_no.clone(),
        }
    }
}
