use regex::Regex;
use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};

/// Token 解析结果：尽可能多地从粘贴内容里挖出邮箱 / 密码 / token
#[derive(Debug, Clone, Serialize)]
pub struct ParsedToken {
    pub email: Option<String>,
    #[serde(rename = "emailPassword")]
    pub email_password: Option<String>,
    #[serde(rename = "cursorPassword")]
    pub cursor_password: Option<String>,
    /// 写入 Cursor 的完整凭证：优先保留 `user_xxx::eyJ...` 会话串，不仅是 JWT
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(rename = "rawSource")]
    pub raw_source: String,
}

/// 兼容这些格式（含混合）：
///   1. 纯 JWT:           eyJhbG...
///   2. 会话串:           user_xxx::eyJhbG...
///   3. WorkosCursorSessionToken=user_xxx::eyJhbG... （从 cookie 复制）
///   4. JSON:             {"email":"...","access_token":"..."}
///   5. email----token
///   6. email----emailPwd----cursorPwd----token
pub fn parse(raw_input: &str) -> AppResult<ParsedToken> {
    let raw = raw_input.trim();
    if raw.is_empty() {
        return Err(AppError::TokenParse("内容为空".into()));
    }

    if let Some(parsed) = try_parse_json(raw) {
        return Ok(parsed);
    }

    // Cookie 格式：WorkosCursorSessionToken=user_xxx::eyJhbG...
    if let Some(captures) = workos_cookie_re().captures(raw) {
        let token = captures
            .name("token")
            .map(|m| decode_cookie_token(m.as_str()))
            .ok_or_else(|| AppError::TokenParse("Cookie 格式中未发现 token".into()))?;
        let token = normalize_access_token(&token)
            .ok_or_else(|| AppError::TokenParse("Cookie 中的 token 无效".into()))?;
        return Ok(build_parsed(None, None, None, token, raw));
    }

    // 四段：email----emailPwd----cursorPwd----token（token 段可含 ----）
    if let Some(parts) = split_four_segments(raw) {
        let (email, email_pwd, cursor_pwd, token_str) = parts;
        let token = normalize_access_token(&token_str)
            .ok_or_else(|| AppError::TokenParse("第四段不是合法 token".into()))?;
        return Ok(build_parsed(
            Some(email),
            Some(email_pwd),
            Some(cursor_pwd),
            token,
            raw,
        ));
    }

    // 两段：email----token
    if let Some(parts) = split_two_segments(raw) {
        let (email, token_str) = parts;
        let token = normalize_access_token(&token_str)
            .ok_or_else(|| AppError::TokenParse("第二段不是合法 token".into()))?;
        return Ok(build_parsed(Some(email), None, None, token, raw));
    }

    // 纯会话串 / 纯 JWT
    if let Some(token) = normalize_access_token(raw) {
        return Ok(build_parsed(None, None, None, token, raw));
    }

    Err(AppError::TokenParse(
        "无法识别格式，请粘贴 token / user_xxx::token / email----token / JSON 卡密".into(),
    ))
}

/// API 请求用：从会话串或纯 JWT 取出 JWT 部分
pub fn jwt_part(token: &str) -> &str {
    let t = token.trim();
    if let Some((_, jwt)) = t.split_once("::") {
        let jwt = jwt.trim();
        if jwt.starts_with("eyJ") {
            return jwt;
        }
    }
    t
}

/// 用量 Cookie 用：优先取 `user_xxx::` 前缀，否则从 JWT sub 解
pub fn session_user_id(token: &str) -> Option<String> {
    let t = token.trim();
    if let Some((uid, jwt)) = t.split_once("::") {
        let uid = uid.trim();
        let jwt = jwt.trim();
        if uid.starts_with("user_") && jwt.starts_with("eyJ") {
            return Some(uid.to_string());
        }
    }
    extract_user_id_from_jwt(jwt_part(t))
}

fn build_parsed(
    email: Option<String>,
    email_password: Option<String>,
    cursor_password: Option<String>,
    access_token: String,
    raw: &str,
) -> ParsedToken {
    ParsedToken {
        email,
        email_password,
        cursor_password,
        refresh_token: Some(access_token.clone()),
        access_token,
        raw_source: raw.to_string(),
    }
}

fn try_parse_json(raw: &str) -> Option<ParsedToken> {
    if !raw.starts_with('{') {
        return None;
    }
    let v: Value = serde_json::from_str(raw).ok()?;
    let account = v.get("account_json").unwrap_or(&v);
    let email = account
        .get("email")
        .and_then(|e| e.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| email_re().is_match(s));
    let token = ["access_token", "accessToken", "token"]
        .iter()
        .find_map(|k| account.get(*k).and_then(|t| t.as_str()))
        .or_else(|| v.get("token").and_then(|t| t.as_str()))?;
    let token = normalize_access_token(token)?;
    Some(build_parsed(email, None, None, token, raw))
}

/// 规范化写入 Cursor 的 accessToken：会话串原样保留，纯文本则提取 JWT
fn normalize_access_token(input: &str) -> Option<String> {
    let t = input.trim();
    if t.is_empty() {
        return None;
    }
    if is_session_token(t) {
        return Some(t.to_string());
    }
    extract_jwt_like(t)
}

fn is_session_token(s: &str) -> bool {
    let t = s.trim();
    let Some((uid, jwt)) = t.split_once("::") else {
        return false;
    };
    uid.trim().starts_with("user_") && jwt.trim().starts_with("eyJ")
}

fn decode_cookie_token(s: &str) -> String {
    s.trim()
        .replace("%3A%3A", "::")
        .replace("%3a%3a", "::")
}

/// JWT 格式：xxx.yyy.zzz，每段都是 base64-url 字符
fn jwt_re() -> Regex {
    Regex::new(r"(?i)\b(eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]+)\b").unwrap()
}

/// Cookie 格式：WorkosCursorSessionToken=<value>
fn workos_cookie_re() -> Regex {
    Regex::new(r"(?i)WorkosCursorSessionToken\s*=\s*(?P<token>[^;\s]+)").unwrap()
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

fn extract_user_id_from_jwt(jwt: &str) -> Option<String> {
    use base64::Engine;
    let payload_b64 = jwt.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .ok()?;
    let json: Value = serde_json::from_slice(&decoded).ok()?;
    let sub = json.get("sub")?.as_str()?;
    sub.rsplit('|').next().map(|s| s.to_string())
}

fn split_four_segments(raw: &str) -> Option<(String, String, String, String)> {
    let (sep, parts) = split_by_sep(raw);
    if parts.len() < 4 {
        return None;
    }
    if !email_re().is_match(parts[0].trim()) {
        return None;
    }
    let token_str = parts[3..].join(sep);
    Some((
        parts[0].trim().to_string(),
        parts[1].trim().to_string(),
        parts[2].trim().to_string(),
        token_str.trim().to_string(),
    ))
}

fn split_two_segments(raw: &str) -> Option<(String, String)> {
    let (_, parts) = split_by_sep(raw);
    if parts.len() != 2 {
        return None;
    }
    if !email_re().is_match(parts[0].trim()) {
        return None;
    }
    Some((parts[0].trim().to_string(), parts[1].trim().to_string()))
}

fn split_by_sep(raw: &str) -> (&'static str, Vec<String>) {
    for sep in &["----", "---", "--", "\t", "|"] {
        if raw.contains(sep) {
            return (
                *sep,
                raw.split(sep).map(|s| s.to_string()).collect(),
            );
        }
    }
    ("", vec![raw.to_string()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_token_kept_intact() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.abcdef01.ghijklmn02";
        let raw = format!("user_01ABCDEF::{jwt}");
        let p = parse(&raw).unwrap();
        assert_eq!(p.access_token, raw);
        assert_eq!(jwt_part(&p.access_token), jwt);
        assert_eq!(session_user_id(&p.access_token).as_deref(), Some("user_01ABCDEF"));
    }

    #[test]
    fn four_part_with_session_token() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.abcdef01.ghijklmn02";
        let raw = format!("a@b.com----pw1----pw2----user_01X::{jwt}");
        let p = parse(&raw).unwrap();
        assert_eq!(p.email.as_deref(), Some("a@b.com"));
        assert_eq!(p.access_token, format!("user_01X::{jwt}"));
    }
}
