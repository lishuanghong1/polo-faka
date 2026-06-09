use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags};

use crate::error::AppResult;

/// VSCode/Cursor 用的存储表 schema：
///   CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)
/// 值是 UTF-8 字符串，新版有时是 JSON。
const ENSURE_TABLE: &str = "CREATE TABLE IF NOT EXISTS ItemTable (\
    key TEXT PRIMARY KEY, value BLOB NOT NULL)";

/// 备份 state.vscdb（连同 -wal / -shm 一起复制）
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
        if src.exists() {
            let file_name = src.file_name().unwrap();
            let dst = backup_dir.join(file_name);
            fs::copy(&src, &dst)?;
            copied.push(dst);
        }
    }
    Ok(copied)
}

/// 读取一个 key（不存在返回 None）
pub fn get(path: &Path, key: &str) -> AppResult<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    let conn = open(path)?;
    let val: Option<String> = conn
        .query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .ok();
    Ok(val)
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
            "INSERT INTO ItemTable(key, value) VALUES(?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )?;
        for (k, v) in items {
            stmt.execute(params![k, v])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// 以读写模式打开（NO_MUTEX 让 rusqlite 自己处理串行）
fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    Ok(conn)
}
