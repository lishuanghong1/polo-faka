# 供货渠道移除说明

## 项目结构

- `apps/web`：Vue 3 商城与管理后台，负责商品、订单、兑换及站点配置。
- `apps/api`：NestJS 服务，Prisma/MySQL 保存商品与订单，Redis 控制重复结算和发货。
- `apps/desktop`、`apps/vscode-ext`：独立客户端，本次未发现这三组渠道依赖。

## 移除范围

| 渠道 | 原实现 | 移除的功能 |
| --- | --- | --- |
| Team 售号 | `cursor-sell`、`CURSOR_SELL` | 商品同步、跟价、钱包充值、采购、授权登录、现做轮询、交付面板 |
| Aizhp | `aizhp-open`、`AIZHP` | 供货、渠道退款/回收、渠道接码 |
| Cursorforge | `forge-openapi`、`forge-redeem` | 三方商城、兑换码余额、额度包、采购、订单、接码 |

这些渠道的页面、路由、菜单、配置、API、定时任务和付款分支均退出运行。
本地卡密、号池额度、人工交付、仓库、账号库、会员积分、充值及支付宝仍保留。
Cursor 官方接口使用的退款团队 ID 和本地商品名称中的 Team 与售号渠道无关。

## 历史数据与升级

- 公共商品接口只展示可支持的交付类型，旧渠道商品不可下单或兑换。
- 已存本地订单仍可查看已交付卡密，未交付的旧渠道订单需要管理员处理。
- 旧三方订单不再进入采购、重试或支付流程；专属页面和 API 不再提供服务。
- 若升级前的 Cursorforge 支付仍在途中，验签成功的 F/Q 订单回调只写支付宝
  审计记录并标记需要人工对账，不恢复采购或交付。管理员需按订单号和支付宝
  交易号核对历史订单并处理退款；本地表中的旧 Team/Aizhp 付款正常记为 PAID。
- Prisma 保留旧枚举、渠道表及历史迁移，防止部署时 `prisma db push` 删除订单、
  采购记录、账号凭据、兑换余额和折扣数据。保留数据库结构不会启用渠道。
- 容器启动的 `post-deploy.cjs` 幂等下架在售的 Team/Aizhp 商品、关闭渠道缓存与
  配置开关；它不删除订单、不退款、不转换交付类型，也不清空任何余额。
- 原有 API Key/Secret 不再读取或返回；旧环境变量可从部署环境移除。

按原部署流程重建前后端即可生效；本次代码修改没有连接或更改生产数据库。
非容器部署可以在完成 schema 同步后执行 `node apps/api/scripts/post-deploy.cjs`
更新旧商品状态；服务端拦截不依赖该脚本。

## 验证

已通过前后端构建、Prisma schema 校验和 63 项后端测试（46 项渠道回归、
5 项退款、12 项额度）。渠道回归覆盖旧商品禁止购买和兑换、本地交付、
历史付款保护、Mock/支付宝入口及旧配置拒绝读取和写入。
另外验证了 Vue 实际渲染的正常、停售、用完三种兑换码提示，差异格式检查通过。

```bash
pnpm --filter @polo/api build
pnpm --filter @polo/web build
pnpm --filter @polo/api exec prisma validate
pnpm --filter @polo/api run test:channels
pnpm --filter @polo/api run test:refund
pnpm --filter @polo/api run test:cursor-quota
```

支付网关、真实 MySQL/Redis 和线上部署需要在对应运行环境验证。
