// Windows 桌面应用不需要附加控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    polo_account_tool_lib::run();
}
