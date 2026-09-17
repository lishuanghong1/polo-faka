# Cursor 额度查询

一个独立、零第三方运行时依赖的 Cursor 额度查询页。Node 服务负责读取
Cursor 的账户、账期摘要和逐条用量事件，浏览器不会直接跨域访问 Cursor。

## 启动

```powershell
cd D:\polo_faka\quota-check-clone
node server.mjs
```

访问 `http://127.0.0.1:4173/quota-check`。

可选环境变量：

- `PORT`：监听端口，默认 `4173`
- `HOST`：监听地址，默认只监听 `127.0.0.1`
- `CURSOR_USAGE_SUMMARY_ENDPOINT`：测试环境的 Cursor 兼容接口地址
- `CURSOR_ME_ENDPOINT`：测试环境的 Cursor 账户接口地址
- `CURSOR_USAGE_EVENTS_ENDPOINT`：测试环境的 Cursor 用量事件接口地址

## 用量计算

服务端读取以下只读接口：

- `/api/auth/me`：账户邮箱与名称
- `/api/usage-summary`：会员、账期和 API/Auto 使用百分比
- `/api/dashboard/get-filtered-usage-events`：当前账期逐条用量

指标口径：

- 总请求数：账期事件总数；错误未计费事件也算一次请求
- 总 Tokens：输入、输出、缓存写入、缓存读取四项相加
- 事件费用：`tokenUsage.totalCents / 100`，而不是 `chargedCents`
- 套餐内：`kind` 匹配 `USAGE_EVENT_KIND_INCLUDED_IN_*`
- 超额：其它事件，包括 `FREE_CREDIT` 与错误未计费事件
- API 卡片 Tokens：输入、输出、缓存读取三项相加，不含缓存写入
- API/Auto/总百分比：直接采用 `usage-summary` 的官方字段

Token 只用于当前请求的 `WorkosCursorSessionToken` Cookie，不写文件、不打印、
不包含在接口响应中。
