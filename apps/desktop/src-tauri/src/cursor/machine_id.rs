use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::cursor::paths::CursorPaths;
use crate::cursor::storage_json;
use crate::error::AppResult;

/// 一次重置生成的所有新机器标识
#[derive(Debug, Clone, serde::Serialize)]
pub struct NewMachineIds {
    /// UUID v4 形式，如 "550e8400-e29b-41d4-a716-446655440000"
    pub dev_device_id: String,
    /// 64 位十六进制，sha256 风格
    pub machine_id: String,
    /// 64 位十六进制
    pub mac_machine_id: String,
    /// 大写带花括号 UUID，"{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
    pub sqm_id: String,
}

impl NewMachineIds {
    pub fn generate() -> Self {
        let mut rng = rand::thread_rng();
        let mut buf = [0u8; 32];

        rng.fill_bytes(&mut buf);
        let machine_id = hex::encode(Sha256::digest(buf));

        rng.fill_bytes(&mut buf);
        let mac_machine_id = hex::encode(Sha256::digest(buf));

        let dev_device_id = Uuid::new_v4().to_string();
        let sqm_id = format!("{{{}}}", Uuid::new_v4().to_string().to_uppercase());

        Self {
            dev_device_id,
            machine_id,
            mac_machine_id,
            sqm_id,
        }
    }
}

/// 把新机器码写入 storage.json + machineid 文件。
/// 调用方需要先把 storage_json 备份过、Cursor 关掉。
pub fn apply(paths: &CursorPaths, ids: &NewMachineIds) -> AppResult<()> {
    storage_json::ensure_exists(&paths.storage_json)?;
    let mut root: Value = storage_json::read_or_empty(&paths.storage_json);

    storage_json::set_dotted(&mut root, "telemetry.devDeviceId", json!(&ids.dev_device_id));
    storage_json::set_dotted(&mut root, "telemetry.machineId", json!(&ids.machine_id));
    storage_json::set_dotted(&mut root, "telemetry.macMachineId", json!(&ids.mac_machine_id));
    storage_json::set_dotted(&mut root, "telemetry.sqmId", json!(&ids.sqm_id));

    storage_json::write_atomic(&paths.storage_json, &root)?;

    // machineid 文件：部分版本会读这个文件做兜底
    if paths.machine_id_file.exists() || paths.config_dir.exists() {
        std::fs::write(&paths.machine_id_file, &ids.machine_id)?;
    }
    Ok(())
}
