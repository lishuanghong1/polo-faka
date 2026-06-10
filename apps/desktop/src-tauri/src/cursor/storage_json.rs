use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::error::AppResult;

/// 读 storage.json。文件不存在 / 不合法 JSON 都返回空对象，避免上层逻辑分叉
pub fn read_or_empty(path: &Path) -> Value {
    let Ok(raw) = fs::read_to_string(path) else {
        return Value::Object(Map::new());
    };
    serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Map::new()))
}

/// 原子写：先写到 .tmp 再 rename，避免写到一半进程被杀导致 storage.json 损坏
pub fn write_atomic(path: &Path, value: &Value) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(value)?;
    fs::write(&tmp, body)?;
    // Windows 上同名文件 rename 会失败，需要先删掉
    #[cfg(target_os = "windows")]
    {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

/// 把若干 key=value 合并到 root 对象（深度仅 1 层；Cursor 的字段都是顶层平铺）
pub fn merge_top_level(root: &mut Value, patch: impl IntoIterator<Item = (String, Value)>) {
    if !root.is_object() {
        *root = Value::Object(Map::new());
    }
    let obj = root.as_object_mut().expect("ensured object");
    for (k, v) in patch {
        obj.insert(k, v);
    }
}

/// 备份原 storage.json 到 backup_dir/storage.json，文件不存在不算错误
pub fn backup(path: &Path, backup_dir: &Path) -> AppResult<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    fs::create_dir_all(backup_dir)?;
    let dst = backup_dir.join("storage.json");
    fs::copy(path, &dst)?;
    Ok(Some(dst))
}

fn pick_nonempty_str(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

/// 读取当前账号 email（storage.json 顶层点号/斜杠键）
pub fn current_email(root: &Value) -> Option<String> {
    for key in [
        "cursorAuth.cachedEmail",
        "cursor.email",
        "cursorAuth/cachedEmail",
    ] {
        if let Some(email) = pick_nonempty_str(root.get(key)) {
            return Some(email);
        }
    }
    None
}

/// 读取 accessToken（storage.json）
pub fn current_access_token(root: &Value) -> Option<String> {
    for key in ["cursorAuth.accessToken", "cursorAuth/accessToken", "cursor.accessToken"] {
        if let Some(token) = pick_nonempty_str(root.get(key)) {
            return Some(token);
        }
    }
    None
}

/// 读取当前设备 ID：telemetry.devDeviceId / telemetry.machineId
pub fn current_device_id(root: &Value) -> Option<String> {
    for key in ["telemetry.devDeviceId", "telemetry.machineId"] {
        if let Some(id) = pick_nonempty_str(root.get(key)) {
            return Some(id);
        }
    }
    None
}

/// 用「点号路径平铺写法」给 storage.json 写一个键。
/// 例如 key = "cursorAuth.cachedEmail" → 直接在根对象写 "cursorAuth.cachedEmail" 字段；
/// 这是 VSCode/Cursor 的实际存储格式（不是嵌套对象）。
pub fn set_dotted(root: &mut Value, key: &str, value: Value) {
    merge_top_level(root, std::iter::once((key.to_string(), value)));
}

/// 创建一个空 storage.json 文件（如果路径不存在）
pub fn ensure_exists(path: &Path) -> AppResult<()> {
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        write_atomic(path, &json!({}))?;
    }
    Ok(())
}
