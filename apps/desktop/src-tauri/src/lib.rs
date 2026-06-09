pub mod commands;
pub mod cursor;
pub mod error;

use commands::{account, cursor as cursor_cmd, machine, usage};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            cursor_cmd::detect_cursor,
            cursor_cmd::kill_cursor,
            cursor_cmd::launch_cursor,
            account::parse_token,
            account::import_account,
            machine::reset_machine_id,
            usage::query_usage,
            usage::query_usage_from_raw,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
