use std::path::Path;
use std::process::Command;
use std::thread::sleep;
use std::time::{Duration, Instant};

use sysinfo::{ProcessRefreshKind, RefreshKind, System, UpdateKind};

use crate::cursor::paths::CursorPaths;
use crate::error::{AppError, AppResult};

/// 解码 Windows 命令行输出（taskkill 等在中文系统上常为 GBK）
fn decode_cmd_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.trim().to_string();
    }
    #[cfg(target_os = "windows")]
    {
        let (cow, _, _) = encoding_rs::GBK.decode(bytes);
        return cow.trim().to_string();
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::from_utf8_lossy(bytes).trim().to_string()
    }
}

fn make_process_system() -> System {
    System::new_with_specifics(
        RefreshKind::new().with_processes(
            ProcessRefreshKind::new()
                .with_exe(UpdateKind::OnlyIfNotSet)
                .with_cmd(UpdateKind::OnlyIfNotSet),
        ),
    )
}

/// Cockpit 同款：Cursor.exe + 安装目录下的 electron.exe
fn is_cursor_process(name: &str, exe: Option<&std::path::Path>) -> bool {
    let n = name.to_ascii_lowercase();
    if n == "cursor" || n == "cursor.exe" {
        return true;
    }
    if n == "electron.exe" {
        if let Some(exe_path) = exe {
            let p = exe_path.to_string_lossy().to_ascii_lowercase();
            return p.contains("\\cursor\\") || p.contains("/cursor/");
        }
    }
    false
}

fn cursor_pids() -> Vec<u32> {
    let sys = make_process_system();
    sys.processes()
        .values()
        .filter(|p| {
            is_cursor_process(
                p.name().to_string_lossy().as_ref(),
                p.exe(),
            )
        })
        .map(|p| p.pid().as_u32())
        .collect()
}

fn is_pid_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let sys = make_process_system();
    sys.processes().contains_key(&sysinfo::Pid::from_u32(pid))
}

fn wait_pids_exit(pids: &[u32], timeout: Duration) -> bool {
    if pids.is_empty() {
        return true;
    }
    let start = Instant::now();
    loop {
        if pids.iter().all(|pid| !is_pid_running(*pid)) {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        sleep(Duration::from_millis(350));
    }
}

/// 是否检测到任意 Cursor 进程在跑
pub fn is_running() -> bool {
    !cursor_pids().is_empty()
}

fn friendly_kill_detail(raw: &str, pid: Option<u32>) -> String {
    let lower = raw.to_ascii_lowercase();
    let pid_hint = pid
        .map(|p| format!("（PID {p}）"))
        .unwrap_or_default();
    if raw.contains("拒绝") || lower.contains("denied") || lower.contains("access is denied") {
        return format!(
            "无权结束 Cursor 进程{pid_hint}。请手动完全退出 Cursor 后重试，或以管理员身份运行本工具"
        );
    }
    if raw.contains("未找到")
        || raw.contains("没有找到")
        || lower.contains("not found")
        || lower.contains("no tasks")
    {
        return "Cursor 进程可能已退出，请重试".into();
    }
    if raw.is_empty() {
        return format!("无法结束 Cursor 进程{pid_hint}，请手动退出 Cursor 后重试");
    }
    format!("{raw}{pid_hint}")
}

/// 干掉所有 Cursor 进程；等到进程退出 + 文件锁释放
pub fn kill_all() -> AppResult<()> {
    if !is_running() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    windows_taskkill_cursor_tree()?;

    let mut last_err: Option<String> = None;
    for _ in 0..4 {
        let pids = cursor_pids();
        if pids.is_empty() {
            break;
        }
        for pid in &pids {
            if let Err(e) = kill_pid(*pid) {
                last_err = Some(e.to_string());
            }
        }
        if wait_pids_exit(&pids, Duration::from_secs(12)) {
            break;
        }
    }

    if is_running() {
        let pids = cursor_pids();
        let hint = last_err.unwrap_or_else(|| {
            format!(
                "仍有进程：{}",
                pids.iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        });
        return Err(AppError::KillCursor(format!(
            "{hint}。请手动完全退出 Cursor（任务管理器结束 Cursor.exe / 托盘退出）后再试"
        )));
    }

    // Cockpit：关进程后再等一会儿，避免 state.vscdb 仍被锁
    sleep(Duration::from_millis(800));
    Ok(())
}

/// 写入前确认 state.vscdb 可读写（Cursor 完全退出后锁才释放）
pub fn wait_for_db_writable(db_path: &Path) -> AppResult<()> {
    if !db_path.exists() {
        return Ok(());
    }
    let start = Instant::now();
    let timeout = Duration::from_secs(15);
    let mut last_io: Option<std::io::Error> = None;
    while start.elapsed() < timeout {
        match std::fs::OpenOptions::new().read(true).write(true).open(db_path) {
            Ok(_) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                last_io = Some(e);
                sleep(Duration::from_millis(400));
            }
            Err(e) if e.raw_os_error() == Some(32) => {
                // Windows ERROR_SHARING_VIOLATION
                last_io = Some(e);
                sleep(Duration::from_millis(400));
            }
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::Io(last_io.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Cursor 配置文件仍被占用",
        )
    })))
}

#[cfg(target_os = "windows")]
fn windows_taskkill_cursor_tree() -> AppResult<()> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let out = Command::new("taskkill")
        .args(["/IM", "Cursor.exe", "/F", "/T"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| AppError::KillCursor(format!("无法调用 taskkill：{e}")))?;
    if out.status.success() {
        return Ok(());
    }
    let msg = decode_cmd_output(&out.stderr);
    let lower = msg.to_ascii_lowercase();
    if msg.contains("未找到")
        || msg.contains("没有找到")
        || lower.contains("not found")
        || lower.contains("no tasks")
    {
        return Ok(());
    }
    Err(AppError::KillCursor(friendly_kill_detail(&msg, None)))
}

fn kill_pid(pid: u32) -> AppResult<()> {
    if !is_pid_running(pid) {
        return Ok(());
    }
    let sys = make_process_system();
    if let Some(p) = sys.processes().values().find(|p| p.pid().as_u32() == pid) {
        if p.kill() {
            return Ok(());
        }
    }
    fallback_kill_by_pid(pid)
}

#[cfg(target_os = "windows")]
fn fallback_kill_by_pid(pid: u32) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let out = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F", "/T"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| AppError::KillCursor(format!("无法调用 taskkill：{e}")))?;
    if out.status.success() {
        return Ok(());
    }
    let msg = decode_cmd_output(&out.stderr);
    let lower = msg.to_ascii_lowercase();
    if msg.contains("未找到")
        || msg.contains("没有找到")
        || lower.contains("not found")
    {
        return Ok(());
    }
    Err(AppError::KillCursor(friendly_kill_detail(&msg, Some(pid))))
}

#[cfg(not(target_os = "windows"))]
fn fallback_kill_by_pid(pid: u32) -> AppResult<()> {
    let out = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output()
        .map_err(|e| AppError::KillCursor(e.to_string()))?;
    if out.status.success() {
        return Ok(());
    }
    Err(AppError::KillCursor(friendly_kill_detail(
        &decode_cmd_output(&out.stderr),
        Some(pid),
    )))
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
