use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags};

use crate::error::AppResult;

/// VSCode/Cursor 用的存储表 schema：
///   CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)
/// 值是 UTF-8 字符串，新版有时是 JSON。
const ENSURE_TABLE: &str = "CREATE TABLE IF NOT EXISTS ItemTable (\
    key TEXT PRIMARY KEY, value BLOB NOT NULL)";

/// 备份 state.vscdb（连同 -wal / -shm 一起复制）。
/// 大文件在 Cursor 仍占用时会失败 —— 最佳努力，不阻断上机（对齐 Cockpit：注入前不强制全量备份）。
pub fn backup(path: &Path, backup_dir: &Path) -> AppResult<Vec<PathBuf>> {
    if !path.exists() {
        return Ok(vec![]);
    }
    fs::create_dir_all(backup_dir)?;
    let mut copied = vec![];
    let candidates = [
        path.to_path_buf(),
        path.with_extension("vscdb-wal"),
        path.with_extension("vscdb-shm"),
    ];
    for src in candidates {
        if !src.exists() {
            continue;
        }
        let file_name = src.file_name().unwrap();
        let dst = backup_dir.join(file_name);
        match fs::copy(&src, &dst) {
            Ok(_) => copied.push(dst),
            Err(e) if e.raw_os_error() == Some(5) || e.kind() == std::io::ErrorKind::PermissionDenied => {
                // 文件仍被 Cursor 占用：跳过该文件，继续上机
                continue;
            }
            Err(e) => return Err(e.into()),
        }
    }
    Ok(copied)
}

/// 读取一个 key（不存在返回 None）
pub fn get(path: &Path, key: &str) -> AppResult<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    let conn = open_readonly(path)?;
    // value 列有时是 BLOB，直接 get<String> 会失败；统一 CAST 成 TEXT
    let val: Option<String> = conn
        .query_row(
            "SELECT CAST(value AS TEXT) FROM ItemTable WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .ok();
    Ok(val)
}

/// 从 state.vscdb 读当前登录邮箱（Cursor 主存储路径）
pub fn current_email(path: &Path) -> Option<String> {
    for key in ["cursorAuth/cachedEmail", "cursor.email"] {
        if let Ok(Some(raw)) = get(path, key) {
            let trimmed = raw.trim().trim_matches('"');
            if !trimmed.is_empty() && trimmed.contains('@') {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 从 state.vscdb 读 accessToken（新版 Cursor 也可能写在 cursor.accessToken）
pub fn current_access_token(path: &Path) -> Option<String> {
    for key in ["cursorAuth/accessToken", "cursor.accessToken"] {
        if let Ok(Some(raw)) = get(path, key) {
            let trimmed = raw.trim().trim_matches('"');
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 从 state.vscdb 读 Cursor 用户 ID（auth0|user_xxx）
pub fn current_user_id(path: &Path) -> Option<String> {
    for key in ["cursorAuth/userId", "cursorAuth/user_id"] {
        if let Ok(Some(raw)) = get(path, key) {
            let trimmed = raw.trim().trim_matches('"');
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 从 state.vscdb 读设备 ID
pub fn current_device_id(path: &Path) -> Option<String> {
    for key in [
        "telemetry.devDeviceId",
        "telemetry.machineId",
        "storage.serviceMachineId",
    ] {
        if let Ok(Some(raw)) = get(path, key) {
            let trimmed = raw.trim().trim_matches('"');
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 批量 upsert
pub fn upsert_all<'a, I>(path: &Path, items: I) -> AppResult<()>
where
    I: IntoIterator<Item = (&'a str, &'a str)>,
{
    // 没有 db 文件时先创建一个空库
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute(ENSURE_TABLE, [])?;
        drop(conn);
    }
    let conn = open(path)?;
    conn.execute(ENSURE_TABLE, [])?;
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
        )?;
        for (k, v) in items {
            stmt.execute(params![k, v])?;
        }
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cursor::paths::CursorPaths;

    #[test]
    fn reads_local_cursor_auth_when_installed() {
        let Ok(paths) = CursorPaths::detect() else {
            return;
        };
        if !paths.state_db.exists() {
            return;
        }
        let email = current_email(&paths.state_db);
        let token = current_access_token(&paths.state_db);
        let uid = current_user_id(&paths.state_db);
        assert!(
            email.is_some() || uid.is_some() || token.is_some(),
            "state.vscdb 可读但无任何登录字段"
        );
    }
}

/// 以读写模式打开
fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    Ok(conn)
}

/// 只读打开 state.vscdb（配合 WAL 可读当前登录态；勿用 URI，Windows 下会落到空库）
fn open_readonly(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    Ok(conn)
}
