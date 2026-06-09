use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Cursor 的本地配置目录及关键文件路径集合
#[derive(Debug, Clone)]
pub struct CursorPaths {
    /// 配置根目录，例如 Windows 上是 %APPDATA%\Cursor，Mac 上是 ~/Library/Application Support/Cursor
    pub config_dir: PathBuf,
    /// %APPDATA%\Cursor\User\globalStorage\storage.json
    pub storage_json: PathBuf,
    /// %APPDATA%\Cursor\User\globalStorage\state.vscdb
    pub state_db: PathBuf,
    /// %APPDATA%\Cursor\machineid （部分版本读这个文件做设备标识）
    pub machine_id_file: PathBuf,
}

impl CursorPaths {
    /// 返回当前系统下 Cursor 的标准配置目录。
    /// Windows: %APPDATA%\Cursor
    /// macOS:  ~/Library/Application Support/Cursor
    /// Linux:  ~/.config/Cursor
    pub fn config_root() -> AppResult<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            let appdata = dirs::config_dir()
                .ok_or(AppError::CursorNotFound)?;
            Ok(appdata.join("Cursor"))
        }
        #[cfg(target_os = "macos")]
        {
            let app_support = dirs::config_dir()
                .ok_or(AppError::CursorNotFound)?;
            Ok(app_support.join("Cursor"))
        }
        #[cfg(target_os = "linux")]
        {
            let conf = dirs::config_dir().ok_or(AppError::CursorNotFound)?;
            Ok(conf.join("Cursor"))
        }
    }

    /// 探测：能找到配置目录就构造结构体；找不到返回 Err，调用方决定是否降级显示
    pub fn detect() -> AppResult<Self> {
        let root = Self::config_root()?;
        let storage_json = root
            .join("User")
            .join("globalStorage")
            .join("storage.json");
        let state_db = root
            .join("User")
            .join("globalStorage")
            .join("state.vscdb");
        let machine_id_file = root.join("machineid");
        Ok(Self {
            config_dir: root,
            storage_json,
            state_db,
            machine_id_file,
        })
    }

    /// 配置目录本身存在 = Cursor 安装并启动过至少一次
    pub fn is_installed(&self) -> bool {
        self.config_dir.exists()
    }

    /// 返回 Cursor 主程序的可执行路径（用于重新拉起）。
    /// 不同系统/安装方式可能不一样，找不到时返回 None。
    pub fn executable_path() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            // 用户级安装（最常见）
            let local = std::env::var("LOCALAPPDATA").ok().map(PathBuf::from);
            if let Some(p) = local {
                let user_install = p.join("Programs").join("cursor").join("Cursor.exe");
                if user_install.exists() {
                    return Some(user_install);
                }
            }
            // 全机安装
            let candidates = [
                r"C:\Program Files\Cursor\Cursor.exe",
                r"C:\Program Files (x86)\Cursor\Cursor.exe",
            ];
            for c in candidates {
                let p = Path::new(c);
                if p.exists() {
                    return Some(p.to_path_buf());
                }
            }
            None
        }
        #[cfg(target_os = "macos")]
        {
            let p = Path::new("/Applications/Cursor.app");
            if p.exists() {
                Some(p.to_path_buf())
            } else {
                None
            }
        }
        #[cfg(target_os = "linux")]
        {
            // 太多种安装方式（AppImage / snap / 包管理），先返回 None
            None
        }
    }

    /// 工具自己的数据目录，用于存备份和未来的多账号库
    pub fn tool_data_dir() -> AppResult<PathBuf> {
        let base = dirs::data_dir()
            .ok_or_else(|| AppError::Other("无法定位用户数据目录".into()))?;
        let p = base.join("PoloAccountTool");
        std::fs::create_dir_all(&p)?;
        Ok(p)
    }

    /// 备份目录：tool_data_dir/backups/<YYYYMMDD-HHMMSS>
    pub fn new_backup_dir() -> AppResult<PathBuf> {
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let p = Self::tool_data_dir()?.join("backups").join(&stamp);
        std::fs::create_dir_all(&p)?;
        Ok(p)
    }
}
