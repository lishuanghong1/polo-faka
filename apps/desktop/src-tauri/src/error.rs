use serde::Serialize;
use thiserror::Error;

/// 统一错误类型。
/// - 内部用 `?` 自动转换底层错误（IO/JSON/SQLite 等）
/// - 暴露给前端时通过 Serialize 直接序列化，前端拿 `error.message` 就能展示
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Cursor 未安装或未在常见路径找到配置目录")]
    CursorNotFound,

    #[error("token 解析失败：{0}")]
    TokenParse(String),

    #[error("无法关闭 Cursor 进程：{0}")]
    KillCursor(String),

    #[error("无法启动 Cursor：{0}")]
    LaunchCursor(String),

    #[error("IO 错误：{0}")]
    Io(std::io::Error),

    #[error("JSON 错误：{0}")]
    Json(#[from] serde_json::Error),

    #[error("SQLite 错误：{0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        if e.raw_os_error() == Some(5) {
            AppError::Other(
                "无法写入 Cursor 配置文件（拒绝访问）。请先完全退出 Cursor 后再试；若仍失败，以管理员身份运行本工具"
                    .into(),
            )
        } else if e.raw_os_error() == Some(32) {
            AppError::Other(
                "Cursor 配置文件仍被占用，请完全退出 Cursor（含托盘）后重试".into(),
            )
        } else {
            AppError::Io(e)
        }
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Other(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Other(s.to_string())
    }
}

/// 前端只关心 `message`，不暴露内部错误链
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 1)?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
