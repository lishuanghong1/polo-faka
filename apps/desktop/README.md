# Polo 桌面账号工具

一个纯本地的桌面工具：

- 粘贴 token / 卡密 → 一键写入 Cursor 本地存储
- 可选重置机器指纹（devDeviceId / machineId / macMachineId / sqmId）
- 写入前自动备份原 `storage.json` 和 `state.vscdb` 到 `<用户数据目录>/PoloAccountTool/backups/<时间戳>`
- 所有操作均在本机完成，不向任何服务器发送数据

## 开发

需要安装：

- Node.js 20+ / pnpm 10
- Rust 1.77+（`rustup install stable`）
- Windows：WebView2（Win 10/11 自带）；macOS：无额外依赖

```bash
cd apps/desktop
pnpm install
pnpm dev      # 启动 tauri dev，首次会编译 Rust 依赖，耗时 1-3 分钟
```

## 打包

```bash
pnpm tauri icon path/to/source.png   # （可选）生成标准 ICO + 各尺寸 PNG，覆盖 icons/
pnpm build                             # 生成安装包到 src-tauri/target/release/bundle/
```

Windows 产物：`.msi` 或 `.exe` (NSIS)，约 5-10 MB
macOS 产物：`.dmg`，约 5-10 MB（未签名时需要右键打开）

## 工程结构

```
src/                Vue 3 + TS UI
src-tauri/
├─ src/
│  ├─ commands/     #[tauri::command] 对前端暴露的能力
│  ├─ cursor/       Cursor 配置 IO（路径/进程/JSON/SQLite/机器码/token 解析）
│  ├─ error.rs      统一错误类型
│  └─ lib.rs        Tauri Builder + 命令注册
├─ icons/           应用图标
├─ Cargo.toml
└─ tauri.conf.json
```

## 支持的粘贴格式

- 纯 JWT：`eyJhbG...`
- `email----token`
- `email----emailPwd----cursorPwd----token`
- 浏览器复制的 cookie：`WorkosCursorSessionToken=user_xxx::eyJhbG...`

## 备份位置

- Windows：`%APPDATA%\PoloAccountTool\backups\<时间戳>\`
- macOS：`~/Library/Application Support/PoloAccountTool/backups/<时间戳>/`

每次写入前会复制原 `storage.json` 与 `state.vscdb*` 到该目录，出问题可直接覆盖回去。
