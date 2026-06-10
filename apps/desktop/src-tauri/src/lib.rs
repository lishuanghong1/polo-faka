pub mod commands;
pub mod cursor;
pub mod error;
pub mod refresh;
pub mod shop_api;
pub mod store;

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

use commands::{
    account, cursor as cursor_cmd, deep_link as deep_link_cmd, machine, pool as pool_cmd,
    settings as settings_cmd, store as store_cmd, usage,
};
use refresh::RefreshController;
use store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Store::open().expect("打开账号库失败");
    let settings_loaded = store
        .with_conn(|c| store::settings::load(c))
        .unwrap_or_default();
    let controller = Arc::new(RefreshController::new(settings_loaded.auto_refresh_seconds));
    let controller_for_state = controller.clone();

    tauri::Builder::default()
        // 同实例插件必须在最早注册：保证 deep link 唤起时不开第二个进程
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 第二个进程被启动时（比如点了另一个 deep link）：把 URL 转给主进程
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show();
                let _ = w.set_focus();
            });
            let urls = args
                .into_iter()
                .filter(|s| s.starts_with("polo-tool://"))
                .collect::<Vec<_>>();
            if !urls.is_empty() {
                deep_link_cmd::handle_urls(app, urls);
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(store)
        .manage(controller_for_state)
        .setup(move |app| {
            // 注册 URL scheme（dev 模式有效；打包后由系统 installer 写注册表）
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                let _ = app.deep_link().register("polo-tool");
            }
            // 监听 deep link 唤起事件
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event
                    .urls()
                    .iter()
                    .map(|u| u.to_string())
                    .collect::<Vec<_>>();
                deep_link_cmd::handle_urls(&handle, urls);
            });

            // 启动后台刷新任务
            refresh::spawn(app.handle().clone(), controller.clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cursor_cmd::detect_cursor,
            cursor_cmd::kill_cursor,
            cursor_cmd::launch_cursor,
            account::parse_token,
            account::import_account,
            machine::reset_machine_id,
            usage::query_usage,
            usage::query_usage_from_raw,
            usage::query_current_usage,
            // 账号库
            store_cmd::list_accounts,
            store_cmd::delete_account,
            store_cmd::update_account_label,
            store_cmd::save_account_from_raw,
            store_cmd::switch_to_account,
            store_cmd::refresh_account_usage,
            store_cmd::refresh_all_accounts,
            store_cmd::db_path,
            // 设置
            settings_cmd::get_settings,
            settings_cmd::save_settings,
            // 号池联动
            pool_cmd::shop_get_captcha,
            pool_cmd::shop_login,
            pool_cmd::shop_logout,
            pool_cmd::pool_list_my_grants,
            pool_cmd::pool_claim,
            pool_cmd::pool_swap,
            pool_cmd::pool_release,
            pool_cmd::cursor_logout,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
