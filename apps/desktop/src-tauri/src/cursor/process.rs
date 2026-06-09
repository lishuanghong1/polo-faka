use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

use sysinfo::{ProcessRefreshKind, RefreshKind, System};

use crate::cursor::paths::CursorPaths;
use crate::error::{AppError, AppResult};

/// 进程名匹配模式：尽量宽松，Cursor / Cursor.exe 都算
fn is_cursor_process(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "cursor" || n == "cursor.exe"
}

fn make_process_only_system() -> System {
    // sysinfo 0.32：RefreshKind::new() = 不刷新任何项；.with_processes(...) 单独刷进程
    System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::new()),
    )
}

/// 是否检测到任意 Cursor 进程在跑
pub fn is_running() -> bool {
    let sys = make_process_only_system();
    sys.processes()
        .values()
        .any(|p| is_cursor_process(p.name().to_string_lossy().as_ref()))
}

/// 干掉所有 Cursor 进程；等到 file lock 释放为止（最多等 3 秒）
pub fn kill_all() -> AppResult<()> {
    let sys = make_process_only_system();
    let mut killed = 0usize;
    for p in sys.processes().values() {
        if is_cursor_process(p.name().to_string_lossy().as_ref()) {
            // sysinfo 自带 kill；失败再降级到系统命令
            if p.kill() {
                killed += 1;
            } else {
                fallback_kill_by_pid(p.pid().as_u32())?;
                killed += 1;
            }
        }
    }
    if killed == 0 {
        return Ok(());
    }
    // 等一会儿让 SQLite 释放 WAL/SHM 文件锁
    for _ in 0..6 {
        sleep(Duration::from_millis(500));
        if !is_running() {
            return Ok(());
        }
    }
    if is_running() {
        Err(AppError::KillCursor(
            "Cursor 仍在运行，请手动退出后再试".into(),
        ))
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn fallback_kill_by_pid(pid: u32) -> AppResult<()> {
    let out = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .output()
        .map_err(|e| AppError::KillCursor(e.to_string()))?;
    if !out.status.success() {
        return Err(AppError::KillCursor(
            String::from_utf8_lossy(&out.stderr).into(),
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn fallback_kill_by_pid(pid: u32) -> AppResult<()> {
    let out = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output()
        .map_err(|e| AppError::KillCursor(e.to_string()))?;
    if !out.status.success() {
        return Err(AppError::KillCursor(
            String::from_utf8_lossy(&out.stderr).into(),
        ));
    }
    Ok(())
}

/// 拉起 Cursor。找不到可执行路径时返回 false（不算错误，UI 会提示让用户手动打开）
pub fn launch() -> AppResult<bool> {
    let Some(exe) = CursorPaths::executable_path() else {
        return Ok(false);
    };
    #[cfg(target_os = "windows")]
    {
        Command::new(&exe)
            .spawn()
            .map_err(|e| AppError::LaunchCursor(e.to_string()))?;
    }
    #[cfg(target_os = "macos")]
    {
        // .app 用 open -a 启动
        Command::new("open")
            .args(["-a", &exe.to_string_lossy()])
            .spawn()
            .map_err(|e| AppError::LaunchCursor(e.to_string()))?;
    }
    #[cfg(target_os = "linux")]
    {
        let _ = exe;
        return Ok(false);
    }
    Ok(true)
}
