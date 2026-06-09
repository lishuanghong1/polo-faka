use regex::Regex;
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Token 解析结果：尽可能多地从粘贴内容里挖出邮箱 / 密码 / token
#[derive(Debug, Clone, Serialize)]
pub struct ParsedToken {
    pub email: Option<String>,
    #[serde(rename = "emailPassword")]
    pub email_password: Option<String>,
    #[serde(rename = "cursorPassword")]
    pub cursor_password: Option<String>,
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(rename = "rawSource")]
    pub raw_source: String,
}

/// 兼容这些格式（含混合）：
///   1. 纯 JWT:           eyJhbG...
///   2. WorkosCursorSessionToken=user_xxx::eyJhbG... （从 cookie 复制）
///   3. email----token
///   4. email----emailPwd----cursorPwd----token
///   5. 上面格式被空白/换行包围
pub fn parse(raw_input: &str) -> AppResult<ParsedToken> {
    let raw = raw_input.trim();
    if raw.is_empty() {
        return Err(AppError::TokenParse("内容为空".into()));
    }

    // Cookie 格式：WorkosCursorSessionToken=user_xxx::eyJhbG...
    if let Some(captures) = workos_cookie_re().captures(raw) {
        let token = captures
            .name("token")
            .map(|m| m.as_str().trim().to_string())
            .ok_or_else(|| AppError::TokenParse("Cookie 格式中未发现 token".into()))?;
        return Ok(ParsedToken {
            email: None,
            email_password: None,
            cursor_password: None,
            access_token: token.clone(),
            refresh_token: Some(token),
            raw_source: raw.to_string(),
        });
    }

    // 四段：email----emailPwd----cursorPwd----token
    if let Some(parts) = split_four_segments(raw) {
        let (email, email_pwd, cursor_pwd, token_str) = parts;
        let token = extract_jwt_like(&token_str)
            .ok_or_else(|| AppError::TokenParse("第四段不是合法 token".into()))?;
        return Ok(ParsedToken {
            email: Some(email),
            email_password: Some(email_pwd),
            cursor_password: Some(cursor_pwd),
            access_token: token.clone(),
            refresh_token: Some(token),
            raw_source: raw.to_string(),
        });
    }

    // 两段：email----token
    if let Some(parts) = split_two_segments(raw) {
        let (email, token_str) = parts;
        let token = extract_jwt_like(&token_str)
            .ok_or_else(|| AppError::TokenParse("第二段不是合法 token".into()))?;
        return Ok(ParsedToken {
            email: Some(email),
            email_password: None,
            cursor_password: None,
            access_token: token.clone(),
            refresh_token: Some(token),
            raw_source: raw.to_string(),
        });
    }

    // 纯 token
    if let Some(token) = extract_jwt_like(raw) {
        return Ok(ParsedToken {
            email: None,
            email_password: None,
            cursor_password: None,
            access_token: token.clone(),
            refresh_token: Some(token),
            raw_source: raw.to_string(),
        });
    }

    Err(AppError::TokenParse(
        "无法识别格式，请粘贴 token 或 email----token / email----emailpwd----cursorpwd----token".into(),
    ))
}

/// JWT 格式：xxx.yyy.zzz，每段都是 base64-url 字符
fn jwt_re() -> Regex {
    Regex::new(r"(?i)\b(eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]+)\b").unwrap()
}

/// Cookie 格式：WorkosCursorSessionToken=user_xxxx::<JWT>
fn workos_cookie_re() -> Regex {
    Regex::new(
        r"(?i)WorkosCursorSessionToken\s*=\s*[^;\s]*?(?P<token>eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]+)",
    )
    .unwrap()
}

fn email_re() -> Regex {
    Regex::new(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$").unwrap()
}

/// 从一段字符串里抓出第一个 JWT
pub fn extract_jwt_like(input: &str) -> Option<String> {
    jwt_re()
        .captures(input)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

/// 切分 email----emailPwd----cursorPwd----token
/// 分隔符兼容 "----" / "—" / "----" 等常见变体
fn split_four_segments(raw: &str) -> Option<(String, String, String, String)> {
    let parts = split_by_sep(raw);
    if parts.len() != 4 {
        return None;
    }
    if !email_re().is_match(parts[0].trim()) {
        return None;
    }
    Some((
        parts[0].trim().to_string(),
        parts[1].trim().to_string(),
        parts[2].trim().to_string(),
        parts[3].trim().to_string(),
    ))
}

fn split_two_segments(raw: &str) -> Option<(String, String)> {
    let parts = split_by_sep(raw);
    if parts.len() != 2 {
        return None;
    }
    if !email_re().is_match(parts[0].trim()) {
        return None;
    }
    Some((parts[0].trim().to_string(), parts[1].trim().to_string()))
}

fn split_by_sep(raw: &str) -> Vec<String> {
    // 优先用 4 个减号；失败再降级到 3、2 个 / 制表符 / 竖线
    for sep in &["----", "---", "--", "\t", "|"] {
        if raw.contains(sep) {
            return raw.split(sep).map(|s| s.to_string()).collect();
        }
    }
    vec![raw.to_string()]
}
