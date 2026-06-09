//! Deep link 入口：商城 / 浏览器里点 polo-tool://import?token=...&email=... 会拉起本工具。
//!
//! 我们不直接执行导入（避免 URL 一进来就改用户配置），只是把解析结果 emit 给前端，
//! 前端把字段填到粘贴框，由用户确认后再点「导入」。

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use url::Url;

#[derive(Debug, Clone, Serialize)]
pub struct DeepLinkImportEvent {
    pub email: Option<String>,
    pub token: Option<String>,
    /// 原始 URL，用于调试 / 显示
    pub raw: String,
    /// "import" / 其它（未来扩展）
    pub action: String,
}

/// 接收 deep link 字符串数组（Tauri 会以列表传入），尝试解析并 emit 到前端
pub fn handle_urls(app: &AppHandle, urls: Vec<String>) {
    for url in urls {
        if let Some(ev) = parse(&url) {
            let _ = app.emit("deep-link-import", ev);
        }
    }
}

fn parse(raw: &str) -> Option<DeepLinkImportEvent> {
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "polo-tool" {
        return None;
    }
    // 支持两种 URL 形态：
    //   polo-tool://import?token=...&email=...
    //   polo-tool:///import?token=...
    let action = if !url.path().is_empty() && url.path() != "/" {
        url.path().trim_start_matches('/').to_string()
    } else {
        url.host_str().unwrap_or("import").to_string()
    };
    let mut email = None;
    let mut token = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "email" => email = Some(v.into_owned()),
            "token" | "access_token" | "accessToken" => token = Some(v.into_owned()),
            _ => {}
        }
    }
    Some(DeepLinkImportEvent {
        email,
        token,
        raw: raw.into(),
        action,
    })
}
