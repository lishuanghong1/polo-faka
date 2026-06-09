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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl<'a> ShopApi<'a> {
    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base.trim_end_matches('/'), path)
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
        if !status.is_success() {
            // 尽量取后端返回的 message，否则给状态码
            let text = resp.text().await.unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| {
                    v.pointer("/error/message")
                        .or_else(|| v.get("message"))
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| format!("HTTP {status}"));
            return Err(AppError::Other(msg));
        }
        resp.json::<T>()
            .await
            .map_err(|e| AppError::Other(format!("商城接口响应解析失败：{e}")))
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
        self.get_json("/pool/grants/mine").await
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
