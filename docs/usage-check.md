# 前台 Cursor 额度查询

页面位于 `/usage-check`，首页卡片、桌面导航和移动端菜单均有入口，无需登录商城。

支持粘贴 `WorkosCursorSessionToken` 的值、完整 Cookie 或编码的 `::`，查看会员类型、账期、套餐额度、按需费用、赠送金额度使用、模型统计和用量明细。支持高级模型筛选、模型/类型/北京时间日期筛选、分页、Ctrl/⌘ + Enter 查询和取消查询。

## 接口

`POST /api/usage-check`，请求 JSON：`{"token":"user_example::header.payload.signature"}`。

成功返回 `{ success: true, data: QuotaReport }`；失败使用项目标准错误格式及对应 HTTP 状态码。每个 IP 每分钟最多查询 5 次，所有接口响应设置 `Cache-Control: no-store`。

查询直接复用 `CursorUsageService`，只访问 Cursor 官方账号、账期汇总、用量聚合和用量明细接口。新模块不依赖数据库、号池或定时任务，不保存查询 Token；页面也不将 Token 写入 URL、浏览器存储或查询历史。浏览器等待 65 秒，错误提示在页面内显示。

## 展示口径

- 官方套餐聚合与按需费用分别展示；赠送金额度使用单独列出。
- `planUsedCents`、`planRemainingCents` 和 `officialTotalPercentUsed` 直接保留官方套餐字段，缺失时为 `null`，金额回退值明确标为估算。
- “按金额计算”的使用比例由套餐已用金额除以上限得到，与官方多额度池综合使用比例分别展示；不能用官方综合比例反推剩余额度。
- API / Auto 使用比例是官方返回的独立指标，不相加。对应 Tokens 按记录的模型名称分类，不代表当前官方用量池的完整分类。
- 高级模型开关过滤 Auto / default / Composer / cursor-grok 的模型统计和明细，账户账单卡片保持全账期口径。
- 模型汇总采用官方账单分配口径，逐条明细采用记录费用，两者可能不同；未把既有 API / Auto 金额分配结果作为真实费用展示。
- 模型单价不固定在页面内，计费说明链接到 [Cursor 官方模型计费文档](https://cursor.com/cn/docs/models-and-pricing)。

既有号池计费字段和算法保留原行为，新增原始字段不改变后台计费。无需数据库迁移。

## 验证与部署

```powershell
pnpm --filter @polo/api test:usage-check
pnpm --filter @polo/api test:cursor-quota
pnpm --filter @polo/api build
pnpm --filter @polo/web build
```

按项目现有流程同时部署 API 和 Web，公开页面的查询由 API 提供。页面已使用真实账号完成官方只读查询验证；桌面与移动端检查覆盖筛选、分页、计费说明、错误提示和请求取消。
