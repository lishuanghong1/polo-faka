# Team 售号渠道 需求文档

> 对接上游「Cursor 成品号购买 API」（`https://cursor.zhangyuwang.cn/api/open/sell`），把上游账号作为本站商品的一种**发货渠道**接入。
> 版本：v1.1 · 2026-09-05 · 状态：已实现（本文档即验收口径）
> v1.1 新增：渠道商品自动上架 / 一键上架，售价 = 成本 + 加价 并随渠道价自动变动，上下架跟随，下单价格保护（§5.3a）

---

## 1. 背景与目标

本站（Polo Faka）已有卡密自动发货、Aizhp 渠道、Cursorforge 三方商城等多种货源。上游售号平台提供了按 SKU 买号的 API：用 API Key + 售号钱包余额下单，成交即返回账号凭据（邮箱 / 密码 / Token / 原始行）或提取卡密，并支持授权登录 Team、现做 Team 等特殊交付形态。

**目标**：把上游做成本站商品的「Team 售号渠道」交付类型，做到：

1. 运营在后台配置 Key、同步上游商品、给本站规格绑定上游商品并定价，即可上架销售。
2. 用户通过本站任意支付方式（支付宝 / 余额 / 积分 / 兑换码）付款后，系统**自动向上游采购并把账号发到订单页**，全程无人工。
3. 覆盖上游全部交付形态：凭据直发、多件、授权登录 Team、现做 Team、池卡密、次数票（XB- 提取卡）。
4. 钱是安全的：采购绝不重复扣费；失败可追溯、可重试；余额不足有提醒。
5. 运营可在后台看清每一笔采购、每一个账号的去向，并能手动采购补库存。

**不做**：

- 不做独立的 Team 商城（复用现有商品 / 订单 / 支付体系）。
- 不在前台开放「充值卡兑换到售号钱包」——给运营钱包充值属于后台操作。

---

## 2. 名词

| 名词 | 含义 |
| --- | --- |
| 上游 / 渠道 | cursor.zhangyuwang.cn 成品号购买 API |
| 渠道商品 | 上游 `GET /products` 返回的 SKU（`code`、成本价 `priceCents`、`deliveryFields`、`stock` 等） |
| 售号钱包 | 上游侧的预付款余额，单位分；用 SC- 充值卡兑换充值 |
| 采购单（Purchase） | 本站每次调用 `POST /buy-account` 生成的一条记录，持有幂等键 |
| 成交（Sale） | 上游每个 `saleId`（一个账号）或每张提取卡在本站的一条记录，对应一条卡密 |
| 交付形态 | account 凭据直发 / login 授权登录 / card 池卡密 / extract 次数票；另有 making 现做中 |
| 幂等键 | 上游 `Idempotency-Key` 头：同一键 + 同一商品重试返回同一笔成交，不重复扣费 |

---

## 3. 上游接口与本站功能对照

| 上游接口 | 本站落地 |
| --- | --- |
| 1 `GET /products` | 后台「Team 渠道 → 渠道商品」同步到本地缓存表；cron 每 10 分钟自动同步；商品编辑里规格绑定时下拉选择；前台库存显示上游预估库存 |
| 2 `GET /wallet` | 后台概览卡显示余额；设置页「测试连接」；每小时低余额检查 → 企微提醒 |
| 3 `POST /wallet/redeem` | 后台「Team 渠道 → 概览 & 充值」兑换 SC- 充值卡；写审计 |
| 4 `POST /buy-account` | **订单自动发货**（`markPaidAndDeliver` 新分支）与**后台手动采购**；处理 `account` / `accounts` / `extract` 三种 kind、`login` / `card` 字段、`making` 状态 |
| 5 `GET /orders`、`GET /orders/:id` | 后台对账列表；现做轮询；订单页 / 后台「重取凭据」 |
| 6 `GET /extract-cards` | 后台「提取卡密 / 对账」页显示 XB- 完整明文（仅管理员） |
| 7 `POST /orders/:id/login-approve`、`GET usage`、`GET login-tutorial` | 订单页「授权登录」面板（教程 + 粘贴链接 + 确认）、「查看额度」；后台可代用户确认 |

---

## 4. 角色与场景

### 4.1 运营（管理员）

| 场景 | 入口 | 结果 |
| --- | --- | --- |
| 配置渠道 | 站点设置 → Team 渠道 | 开关、Base URL、API Key（加密存储）、低余额阈值；测试连接 |
| 给钱包充值 | Team 渠道 → 概览 & 充值 | 输入 SC- 码 → 到账金额与余额；审计 `CURSOR_SELL_WALLET_REDEEM` |
| 同步商品 | Team 渠道 → 渠道商品 | 看到 code / 名称 / 档位 / 成本 / 库存 / 交付方式 / 现做标记；下架商品灰显 |
| 上架商品 | 商品 → 新建/编辑 → 交付类型「Team 售号渠道」 | 每个规格从缓存里选一个渠道商品；显示成本并在售价低于成本时警告；次数票可选「拆分」 |
| 看采购与账号 | Team 渠道 → 采购单 | 按状态 / 来源 / 关键字筛选；详情看幂等键、失败原因、每个成交的凭据（Token 默认打码）、上游原始响应 |
| 处理失败 | 采购单 → 重试；或订单 → 补发 | 同一幂等键重放；余额不足先充值再重试 |
| 手动采购补库存 | Team 渠道 → 手动采购 | 选商品 + 数量 → 采购 → 直接写入某规格卡密池 / 推入仓库 / 仅记录稍后入库 |
| 代用户授权登录 | 采购单详情 → 成交卡片 | 粘贴用户发来的 loginDeepControl 链接 → 确认 |
| 对账 | Team 渠道 → 提取卡密 / 对账 | 上游订单摘要 + 我的提取卡 |

### 4.2 买家（前台）

| 场景 | 表现 |
| --- | --- |
| 浏览商品 | 规格显示渠道预估库存；提示「付款后自动从渠道采购，数秒内到账」 |
| 下单 | 规格未绑定渠道商品或渠道商品已下架 → 拒绝下单并提示联系客服；现做 Team 单次 ≤ 5，其它 ≤ 50 |
| 付款后（凭据直发） | 订单页「账号交付」面板：邮箱 / 密码 / Token（默认打码，可显示）逐项复制、复制全部、质保到期倒计时、查看额度 |
| 付款后（现做 Team） | 订单保持「已付款 · 发货中」，面板显示「开通中」+「立即检查」；系统每分钟轮询，就绪后自动补全并变为已发货 |
| 付款后（授权登录） | 面板给出 3 步说明 + 图文教程；粘贴 `cursor.com/loginDeepControl?…` 链接 → 确认授权 → 回到 Cursor 即登录；显示「已授权登录」 |
| 付款后（池卡密） | 显示卡密与说明 |
| 付款后（次数票） | 显示 XB- 提取码、剩余次数、上游提取页链接与说明 |
| 渠道缺货 / 异常 | 订单页提示「渠道暂未出货，系统正在自动重试」，附客服联系方式 |
| 凭据不对 | 「重新拉取」按钮从上游重取 |
| 兑换码 | 给 Team 规格生成的本站兑换码（RD-）走原有兑换流程，自动出 Team 账号 |

---

## 5. 功能需求

### 5.1 渠道配置（站点设置 → Team 渠道）

- `cursor_sell_enabled`：总开关。关闭后：不能创建 Team 交付类型商品（已存在的商品下单时提示不可售）、cron 全部跳过、后台页提示未启用。
- `cursor_sell_api_base`：留空用默认地址。
- `cursor_sell_api_key`：AES-GCM 加密入库，保存后不回显；支持「清除已保存的 Key」。除兑换充值卡外的接口都需要 Key。
- `cursor_sell_low_balance_yuan`：低余额阈值（元），留空不提醒。
- 「测试连接」：读库里已保存的配置查余额并统计在售渠道商品数。

### 5.2 渠道商品缓存

- 同步策略：手动同步按钮 + cron 每 10 分钟 + 发货时发现绑定的商品不在缓存里会先同步一次。
- 字段：code、title、tier、priceCents、warrantyHours、deliveryFields、stock、extractOnly、ondemandTeam、active、raw、lastSyncAt。
- 上游本次不再返回的商品：保留记录、`active=false`（历史采购单外键不受影响），商品编辑里灰显不可选，下单时拒绝。
- 交付方式推导：`extractOnly` → 次数票；`deliveryFields` 含 `login` → 授权登录；含 `card` → 池卡密；否则凭据直发。

### 5.3 商品与规格绑定

- `Product.deliveryType = CURSOR_SELL`。
- 规格 `Sku.attrs.cursorSellCode`（必填）、`Sku.attrs.cursorSellExtractSplit`（仅次数票商品可勾选）。
- 保存校验：每个规格必须绑定；切换到其它交付类型时清除这两个字段。
- 编辑器展示所选渠道商品的交付方式、字段、质保、现做标记，售价低于成本时红色警告。
- 前台库存 = 缓存库存（上游下架 → 0）。库存为 0 仍允许下单（渠道缺货时会自动重试）。

### 5.3a 自动上架与价格跟随（v1.1）

**规则**（后台 Team 渠道 → 渠道商品 → 「自动上架 & 跟价规则」卡片，存 `site_settings`）：

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `cursor_sell_auto_list` | 开 | 每次同步把新出现的在售渠道商品自动创建为本站商品 |
| `cursor_sell_auto_list_category_id` | 空 = 第一个非"全部"分类 | 自动上架到的分类 |
| `cursor_sell_markup_yuan` | 20 | 固定加价（元） |
| `cursor_sell_markup_percent` | 0 | 比例加价（%），与固定加价取高 |
| `cursor_sell_follow_offshelf` | 开 | 上游下架 → 本站自动下架；上游恢复 → 恢复被系统自动下架的商品 |
| `cursor_sell_min_margin_yuan` | 0 | 下单保护：售价 < 成本 + 保底 时拒绝下单 |

**售价公式**：`max(成本 + 固定加价, 成本 × (1 + 比例))`，保留两位小数；`product.basePrice` = 可见规格最低价。

**规格标记**（`Sku.attrs`）：`cursorSellPricing = { mode:'COST_PLUS', markupYuan, markupPercent }` 表示"跟价"，同步时重算；没有则为手工定价，同步不动。`cursorSellAutoListed` 标记由自动上架创建；`cursorSellAutoOffShelf` 标记被系统自动下架。

**自动上架生成的商品**：标题 = 上游名称；副标题 = `档位 · 质保 N 小时 · 自动发货/现做开通`；描述按交付形态套模板；标签 `Team 渠道 / 档位`；一个规格（名称 = 档位）绑定 code 并跟价；在售；不允许积分支付。**创建后文案永不被同步覆盖**，同步只改价格与上下架状态。

**同步后动作**（每 5 分钟 cron / 手动同步 / 下单前缓存陈旧时）：自动上架新商品 → 重算所有跟价规格 → 上游下架的商品（所有规格都指向已下架 code）置 `OFF_SHELF` 并打标 → 上游恢复且带自动下架标记的商品恢复 `ON_SALE`。同步接口返回 `listing: { listed, repriced, offShelf, restored }`，页面弹提示。

**后台操作**：渠道商品列表增加「本站商品」列（已上架显示商品/规格/售价/跟价或手工价/状态；未上架显示预估售价）、每行「上架」、勾选后「上架选中」或一键「全部上架」。商品编辑里每个 Team 规格有「跟随渠道价」开关 + 固定/比例加价输入并实时预览售价；关闭即手工定价。商品保存时服务端按最新成本重算跟价规格，不信任前端数字。

**下单价格保护**：下单时若缓存超过 6 分钟先同步一次（并发去重，失败不阻塞）；若该规格价格因此变化，拒绝并提示「渠道价格刚刚变动，请刷新页面后重新下单」（避免按用户没看到的新价扣钱）；再校验 `售价 ≥ 成本 + 保底利润`，不满足则拒绝（跟价规格提示刷新，手工价规格提示联系客服）。

审计：`CURSOR_SELL_AUTO_LIST`（上架，含 by=admin / 自动）、`CURSOR_SELL_LISTING_RULES`（规则修改）。

### 5.4 订单自动发货

触发：订单进入 PAID（支付宝回调 / 余额 / 积分 / 兑换码 / 后台标记已付）→ `OrdersService.markPaidAndDeliver` 持订单锁 → `CursorSellFulfilService.deliverOrder`。

流程：

1. 读规格绑定的渠道商品；未绑定或不存在 → 企微提醒，订单留 PAID。
2. 计算还需数量 `need = quantity - 已有卡密数`；为 0 则直接结单。
3. 已有 MAKING 采购单 → 交给 cron，退出。
4. 复用该订单 PENDING 的采购单（同幂等键重试）；若其商品与当前绑定不同，作废并新开；没有则新建，幂等键 `polo:<orderNo>:<code>:<seq>`。
5. 调 `buy-account`（`qty = need`，次数票带 `extractSplit`）。
6. 成功：按 kind 解析 → 每个账号 / 提取卡写一条 `card_keys`（SOLD，绑定订单）+ 一条成交记录（结构化凭据加密保存）；同一采购单重放按 `saleId` / `extractCardId` 去重。
   - 有 `making` → 采购单 MAKING，卡密内容为「开通中」占位，订单留 PAID。
   - 否则采购单 DONE；卡密配齐且无开通中 → 订单 DELIVERED、销量 +qty、积分结算。
7. 失败：见 §6。

卡密 `content` 规则：凭据直发优先上游 `rawLine`，否则 `email----password----token`；授权登录为邮箱；池卡密为 `card  # cardNote`；次数票为 `XB-码  # 提取卡密 · 可用 n/m 次`。`remark` 形如 `[cursor-sell] saleId=… kind=…`。

### 5.5 现做 Team 轮询

- cron 每分钟取最多 20 条 `making=true` 的成交，调 `GET /orders/:saleId`。
- 就绪：回填凭据、更新卡密内容、成交 `making=false`；该采购单无开通中 → DONE；订单卡密配齐且无开通中 → DELIVERED。
- 订单页每 3 秒轮询订单（最长 5 分钟后转手动刷新），面板另有「立即检查」直接触发重取。

### 5.6 授权登录 / 额度 / 教程（订单页 & 后台）

- 鉴权：订单号 +（下单时填过联系方式则必须匹配）；成交必须属于该订单。
- `login-approve`：校验链接必须是 `https://cursor.com/loginDeepControl?…`；上游 `approved=true` 时记录 `loginApprovedAt`；审计 `CURSOR_SELL_LOGIN_APPROVE`（区分用户 / 后台）。
- `usage`：结果缓存到成交记录（`usageJson` / `usageAt`）。
- `login-tutorial`：原文透传，前端兼容字符串 / `content` / `tutorial` / `text` / `markdown` / `html` 字段。
- 现做未就绪时不允许授权（提示稍后）。
- 限流：每分钟 10–12 次 / IP。

### 5.7 后台手动采购与入库

- 选在售渠道商品、数量（现做 ≤ 5，其它 ≤ 50）、次数票可选拆分；显示预计成本并二次确认。
- 幂等键 `polo:manual:<随机>`；采购单 `source=MANUAL`，记录操作人。
- 成交后处理：仅记录 / 写入本站某 CARD_KEY 规格的卡密池（AVAILABLE，`expireAt` = 质保到期）/ 推入仓库（`sourceRef=cursor-sell:<saleId>` 去重，PENDING 待分配）。
- 开通中的成交不能入库；已入库的不能重复入库。授权登录类账号不建议入卡密池（页面有提示）。

### 5.8 采购单与成交明细（后台）

- 列表：状态（PENDING 待重试 / MAKING 开通中 / DONE 已成交 / FAILED 失败）、来源、关键字（订单号 / 商品 / 邮箱 / 幂等键）；显示数量与成交数、成本、尝试次数、失败原因。
- 详情：幂等键、时间线、成交卡片（凭据打码可显示、复制、重取凭据、查额度、代授权、入库）、上游原始响应。
- 重试：ORDER 来源走订单发货入口（复用 PENDING 单；FAILED 单先复位为 PENDING 再同键重放）；MANUAL 来源同键重放。

### 5.9 通知与审计

企微 markdown 提醒（需已配置企业微信群机器人）：

| 场景 | 触发 |
| --- | --- |
| 采购失败（明确失败） | INSUFFICIENT_BALANCE / PRODUCT_* / 配置错误 / 可重试错误超过上限；每张采购单只提醒一次 |
| 连续网络异常 | 同一采购单连续 3 次结果未知 |
| 落库异常 | 上游已成交但本地写库失败（高危，提示同键重试） |
| 响应无法解析 | 上游成交但字段不识别，提示看原始响应手动发货 |
| 规格未绑定 / 商品不存在 | 发货时发现配置问题 |
| 低余额 | 每小时检查，低于阈值当天提醒一次 |

审计动作：`CURSOR_SELL_WALLET_REDEEM`、`CURSOR_SELL_PRODUCT_SYNC`、`CURSOR_SELL_MANUAL_PURCHASE`、`CURSOR_SELL_PURCHASE_RETRY`、`CURSOR_SELL_PUSH_STOCK`、`CURSOR_SELL_LOGIN_APPROVE`。

### 5.10 退款

后台对 Team 订单退款时，`[cursor-sell]` 卡密标 REFUNDED（不回池：账号已从上游买断），余额 / 积分退还沿用现有逻辑。上游侧售后需人工按上游保障期处理。

---

## 6. 失败与重试策略（资金安全核心）

| 上游结果 | 采购单状态 | 后续 |
| --- | --- | --- |
| 成交 | DONE / MAKING | 正常 |
| `UPSTREAM_UNAVAILABLE`（上游声明未扣费） | PENDING | cron 每 5 分钟同键重试，最多 12 次后 FAILED + 提醒 |
| `OUT_OF_STOCK` | PENDING | 同上（库存可能回补） |
| `INSUFFICIENT_BALANCE` / `NO_SALES_WALLET` | FAILED | 立即提醒；充值后重试 |
| `PRODUCT_NOT_FOUND` / `PRODUCT_DISABLED` / `BAD_REQUEST` / `IDEMPOTENCY_*` | FAILED | 提醒；需改绑商品 |
| `NO_KEY` / `INVALID_KEY` / `FORBIDDEN` / `KEY_NOT_BOUND` | FAILED | 提醒；对终端用户统一显示「渠道暂不可用」 |
| 网络错误 / 超时 / 5xx（结果未知） | PENDING（永不自动转 FAILED） | 只允许同键重试；连续 3 次提醒 |
| 成交但本地落库异常 | PENDING + 保存响应 | 同键重放重新落库；立即提醒 |

原则：**结果未知绝不换键重买**；只有上游明确「没成交」才允许开新键。订单在整个过程中保持 PAID，用户侧显示自动重试提示。

---

## 7. 数据模型

```
DeliveryType += CURSOR_SELL
Sku.attrs.cursorSellCode / cursorSellExtractSplit

cursor_sell_products   上游商品缓存（code PK）
cursor_sell_purchases  采购单：idempotencyKey UNIQUE、source、orderNo、productCode FK、qty、status、kind、
                        costCents、responseEnc（加密原始响应）、errorCode、failReason、attempts、lastAttemptAt、
                        operatorId、notifiedAt
cursor_sell_sales      成交：purchaseId FK(cascade)、orderNo、cardKeyId UNIQUE、saleId、extractCardId、kind、
                        tier、email、making、loginApprove、loginApprovedAt、warrantyUntil、soldAt、
                        credentialsEnc（加密凭据）、usageJson、usageAt
```

迁移文件：`apps/api/prisma/migrations/20260905200000_cursor_sell_channel/migration.sql`（生产部署脚本走 `prisma db push`，同样生效）。

---

## 8. 接口清单

后台（ADMIN）`/api/admin/cursor-sell/*`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `overview` | 启用状态、余额、低余额阈值、待处理数、今日采购、商品数、上次同步 |
| POST | `wallet/redeem` | 兑换充值卡 |
| GET / POST | `products`、`products/sync` | 缓存列表（含本站绑定 `local[]`）/ 同步（返回 listing 统计） |
| GET / PUT | `listing-rules` | 自动上架 / 跟价规则 |
| POST | `products/:code/list`、`products/list-batch` | 单个 / 批量上架为本站商品 |
| GET | `purchases`、`purchases/:id` | 采购单列表 / 详情（含成交与原始响应） |
| POST | `purchases/manual` | 手动采购（可选入库） |
| POST | `purchases/:id/retry`、`purchases/:id/push` | 重试 / 批量入库 |
| GET | `sales/:id`、`sales/:id/usage`、`sales/:id/login-tutorial` | 成交详情 / 额度 / 教程 |
| POST | `sales/:id/refresh`、`sales/:id/push`、`sales/:id/login-approve` | 重取凭据 / 入库 / 代授权 |
| GET | `upstream/orders`、`upstream/extract-cards` | 上游对账 / 提取卡明文 |

前台（公开，订单号 + 联系方式鉴权，限流）`/api/cursor-sell/sales/:id/*`：`login-approve`、`usage`、`login-tutorial`、`refresh`。

订单详情 `GET /api/orders/query/:orderNo` 响应新增 `cursorSell.sales[]`（含解密凭据、making、loginApprove、warrantyUntil 等）。

---

## 9. 非功能要求

- **幂等 / 一致性**：见 §6；订单发货在 Redis 订单锁内执行，cron 重试也走同一把锁。
- **安全**：API Key、成交凭据、上游响应均 AES-GCM 加密入库；后台列表 Token 默认打码；前台凭订单号（+联系方式）查看；所有公开接口限流；操作写审计。
- **性能**：采购接口超时 45s；订单页轮询 3s，最长 5 分钟；cron 批量上限（轮询 20 条 / 重试 20 单）。
- **可观测**：服务端日志记录每次上游拒绝 / 网络错误；采购单保存原始响应；企微提醒覆盖所有需人工介入的场景。

---

## 10. 验收清单

1. 设置页填 Key → 测试连接显示余额与在售商品数。
2. Team 渠道页同步商品，列表与上游一致；下架商品灰显。
3. 新建 Team 商品，规格绑定渠道商品；前台库存 = 渠道库存；售价低于成本有警告。
4. 用余额 / 支付宝 / 兑换码分别下单，订单页数秒内显示账号凭据，可复制、可查额度；采购单出现 DONE 记录，成本正确。
5. 购买现做 Team：订单页显示开通中 → 数分钟后自动变为已发货并显示凭据。
6. 购买授权登录 Team：粘贴 loginDeepControl 链接 → 提示授权成功 → Cursor 客户端已登录；后台成交显示已授权时间。
7. 购买次数票：订单页显示 XB- 码与提取指引；后台提取卡密页能看到明文。
8. 把钱包余额降到不足 → 下单后订单留「已支付」，企微收到余额不足提醒；充值后点重试 → 成功发货。
9. 断网 / 上游 503 场景：采购单 PENDING，同键重试后不重复扣费（上游订单摘要只多一条）。
10. 手动采购 3 个写入卡密池 → 对应规格库存 +3，普通卡密订单可正常售出。
11. 审计日志出现对应动作；退款后 Team 卡密为 REFUNDED 不回池。
12. 开启自动上架后同步 → 所有在售渠道商品出现在指定分类，售价 = 成本 + 20；渠道商品页「本站商品」列显示"跟价"。
13. 上游改价后下一次同步（≤5 分钟）本站售价同步变化；商品编辑里关掉「跟随渠道价」并手工改价后，同步不再改动。
14. 上游下架某商品 → 本站对应商品自动下架；恢复后自动上架。
15. 模拟渠道涨价超过加价额：在同步前下单被拒绝并提示刷新，刷新后价格已更新。

---

## 11. 已知限制 / 后续可选

- 采购成本用缓存成本价 × 数量估算（上游成交响应不含金额）；对账以上游订单摘要为准。
- 上游 `accounts` 形态的数组字段名文档未明示，实现兼容 `accounts` / `deliveries` / `items`；若都不匹配会保存原始响应并提醒人工发货。
- 授权登录教程原文由上游返回，前端按纯文本渲染（不渲染 HTML，避免 XSS）。
- 未做「上游保障期内自动售后」；到期 / 掉号仍需人工。
- 可选增强：Team 商品在前台自动按成本价 + 固定利润定价；采购单按天导出对账；上游 webhook（如提供）替代轮询。
