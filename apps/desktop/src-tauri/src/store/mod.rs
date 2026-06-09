//! 工具自己的本地数据库（账号库 + 设置）。
//!
//! 文件位置：<用户数据目录>/PoloAccountTool/accounts.db
//! 用 rusqlite + bundled，避免依赖系统 sqlite。

pub mod accounts;
pub mod settings;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::cursor::paths::CursorPaths;
use crate::error::AppResult;

/// 全局可共享的 DB 连接（rusqlite Connection 不能 Send，所以用 Mutex 串行化）
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// 工具数据库文件路径
    pub fn db_path() -> AppResult<PathBuf> {
        let dir = CursorPaths::tool_data_dir()?;
        Ok(dir.join("accounts.db"))
    }

    /// 打开 / 初始化数据库（首次会建表）
    pub fn open() -> AppResult<Self> {
        let path = Self::db_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        // 性能 + 并发健壮：开 WAL，事务串行化由 Mutex 保证
        conn.execute_batch(
            r#"
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            PRAGMA foreign_keys=ON;
            "#,
        )?;
        accounts::ensure_schema(&conn)?;
        settings::ensure_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 临时拿出连接给闭包用，串行化保证一次只有一个调用方
    pub fn with_conn<R>(&self, f: impl FnOnce(&Connection) -> AppResult<R>) -> AppResult<R> {
        let lock = self.conn.lock().map_err(|_| {
            crate::error::AppError::Other("数据库锁中毒，请重启工具".into())
        })?;
        f(&lock)
    }
}
