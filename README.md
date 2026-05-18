# Polo Faka

仿 `yidachuang.top` 的 AI 账号 / 卡密自动发货商城。

## 技术栈

- **前端**：Vue 3 + Vite + TypeScript + Element Plus + Tailwind + Pinia + Vue I18n
- **后端**：NestJS + Prisma + JWT + Schedule
- **数据库**：MySQL 8 + Redis（分布式锁防超卖）
- **支付**：内置 Mock 通道，预留易支付 / USDT 接口

## 目录结构

```
polo-faka/
├── apps/
│   ├── api/             # NestJS 后端 (@polo/api)
│   │   ├── prisma/      # schema + seed
│   │   └── src/
│   │       ├── common/
│   │       ├── modules/  # auth / products / orders / card-keys / pool / admin ...
│   │       ├── prisma/
│   │       ├── redis/
│   │       └── main.ts
│   └── web/             # Vue 3 前端 (@polo/web)
│       └── src/
│           ├── api/      # axios 封装
│           ├── components/
│           ├── i18n/
│           ├── layouts/  # 前台 / 后台布局
│           ├── pages/    # 前台页面 + admin/ 子目录
│           ├── router/
│           └── stores/
├── docker-compose.yml    # MySQL + Redis
└── package.json          # pnpm workspaces
```

## 一键启动（开发模式）

> 前置：Node 20+、pnpm 10+、Docker。

```bash
# 1. 拉起数据库
pnpm db:up

# 2. 安装依赖
pnpm install

# 3. 初始化数据库（首次或改 schema 后执行）
pnpm prisma:migrate
pnpm prisma:generate
pnpm prisma:seed

# 4. 同时启动前后端
pnpm dev

# 或分开启动：
pnpm dev:api    # http://localhost:4000/api (Swagger: /api/docs)
pnpm dev:web    # http://localhost:5173
```

## 默认账号

- 管理员：`admin` / `admin123456`
  - 登录后右上角 → 后台 → 进入 `/admin`

## 已实现功能

### 前台
- ✓ 首页：商品瀑布流 + 分类 Tab + Banner
- ✓ 商品详情：多规格、批量阶梯价、库存、销量
- ✓ 下单流程（支付宝 / 微信 / 余额 / Mock）
- ✓ 订单查询 / 卡密自动展示 / 一键复制
- ✓ 用户注册 / 登录 / 个人中心 / 余额明细
- ✓ 公告弹窗（once / always 两种模式）
- ✓ Token 一键激活工具页
- ✓ 中英文双语切换

### 后端
- ✓ JWT 鉴权 + 角色守卫
- ✓ 商品 / 分类 / SKU CRUD
- ✓ 订单 + Redis 分布式锁 + 卡密自动出库
- ✓ 余额结算 + 流水
- ✓ 公告管理
- ✓ 反馈收集
- ✓ 号池：账号管理 + 定时刷新额度（10 分钟）+ Token 激活接口（可对接外部）
- ✓ 管理后台：仪表盘 + 订单 / 商品 / 卡密 / 用户 / 公告 / 号池
- ✓ 全局响应包装 `{ success, data, error }`
- ✓ Swagger 文档（`/api/docs`）

## 关键设计

### 卡密自动出库（防超卖）

下单 → 用户支付 → `OrdersService.markPaidAndDeliver()`：

1. 加 Redis 分布式锁 `lock:order:<orderNo>`，防止重复出库
2. 事务内取 `CardKey.status=AVAILABLE` 的 N 条，置为 `SOLD` 并绑定 `orderNo`
3. 库存不足时订单停留在 PAID 状态，后台人工补发

### 库存口径

- `Product.skus[].stock` 仅为展示用历史值
- 真实库存以 `card_keys` 表中 `status=AVAILABLE` 的实时计数为准
- `ProductsService.computeStockBySku()` 统一计算

### 号池玩法

- 管理员把多个 Cursor Pro/Ultra 的 token 灌进 `pool_accounts`
- `PoolQuotaChecker` 每 10 分钟刷新额度（默认 mock，生产替换 `CURSOR_USAGE_ENDPOINT`）
- 用户下单"额度包"商品后，会创建 `pool_grants` 记录，用户在订单页绑定自己的 Token

## 待办（v2）

- [ ] 易支付 / 虎皮椒 / USDT 真实接入
- [ ] 抽奖系统 / 优惠券
- [ ] 富文本编辑器（公告 / 商品描述）
- [ ] 邀请返利、邀请码
- [ ] 站点 SEO（SSR / 预渲染）
- [ ] 卡密池告警（库存低 / 号被封）
- [ ] 邮件 / 站内信通知

## ⚠️ 合规提醒

转售 Cursor / GPT Plus / Claude / WindSurf 等账号违反对应平台 ToS，
存在批量封号、域名被举报、支付通道冻结的风险。本项目仅作技术学习用途。
真实经营时请自行评估法律与商业风险。

## License

私有项目，仅供学习。
