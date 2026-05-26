# Polo Faka 部署手册（从零到上线）

整套架构跑在 **一台 Linux VPS** 上，使用 Docker Compose 编排：

```
互联网
  │
  ▼ 80 / 443 (HTTPS)
┌─────────────────────────────────────┐
│  Caddy  (自动 HTTPS · 反代 · 日志)   │
└──────────────┬──────────────────────┘
       /api/*  │   /*
  ┌────────▼──────┐  ┌──────────▼──────────┐
  │  api          │  │  web                │
  │  Node 20      │  │  Nginx · Vue SPA    │
  └──┬────────────┘  └─────────────────────┘
     │   内网
  ┌──▼────┐   ┌────────┐
  │ MySQL │   │ Redis  │
  └───────┘   └────────┘
```

---

## 一、服务器要求

| 项目 | 推荐 | 最低 |
| --- | --- | --- |
| 操作系统 | Ubuntu 22.04 / Debian 12 | Ubuntu 20.04 |
| CPU | 2 核 | 1 核 |
| 内存 | 2 GB | 1 GB（开 1G swap） |
| 磁盘 | 30 GB SSD | 20 GB |
| 带宽 | 5 Mbps | 1 Mbps |
| 端口 | 22 / 80 / 443 公网放通 | 同左 |

> 1G 内存可以跑，但 `pnpm build` 阶段可能 OOM —— 建议**在本机 build 镜像后 push 到镜像仓库**，或者临时加 swap。

---

## 二、域名 + DNS

1. 买一个域名（推荐 Cloudflare / Namecheap / 阿里云）。
2. 添加 A 记录：`@` 和 `www` 都指向你的服务器 IP。
3. **不要套 Cloudflare 橙云代理**（会和 Caddy 抢 HTTPS）。如要套，把 Caddy 改成 80 only 即可。
4. 等 DNS 生效（`ping example.com` 能看到正确 IP）。

---

## 三、初始化服务器

```bash
# 在本机
ssh root@<服务器IP>

# 在服务器
adduser polo                    # 建一个非 root 用户（可选但推荐）
usermod -aG sudo polo
mkdir -p /opt/polo && chown polo:polo /opt/polo

# 切到 polo
su - polo
cd /opt/polo

# 克隆代码
git clone <你的仓库地址> .       # 注意末尾的 .

# 跑初始化脚本
# Ubuntu/Debian：
sudo bash deploy/init-server.sh
# Rocky/CentOS/RHEL 9：
sudo bash deploy/init-server-rocky.sh

# 重新登录使 docker 组生效
exit
ssh polo@<服务器IP>
cd /opt/polo
docker ps      # 测试无 sudo 也能跑
```

---

## 四、配置环境变量

```bash
cp .env.prod.example .env.prod
nano .env.prod                  # 或 vim
```

**必须修改的项**：

```ini
DOMAIN=你的域名.com

# 用 openssl 生成强密码，每个都不一样
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
MYSQL_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
POOL_ENCRYPTION_KEY=$(openssl rand -hex 32)

ADMIN_DEFAULT_PASSWORD=你的初始密码  # 上线后立即在后台改！

CORS_ORIGINS=https://你的域名.com

# 强烈建议：把你的固定办公/家庭公网 IP 加上
ADMIN_IP_ALLOWLIST=1.2.3.4
```

> 在本机用 `curl ifconfig.me` 拿到你当前的公网 IP。如果是动态 IP，先填 0.0.0.0/0（=不限）上线后再收紧。

---

## 五、一键启动

```bash
cd /opt/polo
bash deploy/deploy.sh
```

脚本会：
1. 校验 `.env.prod` 是否还有 `CHANGEME`；
2. `docker compose build`（首次约 5-10 分钟）；
3. `docker compose up -d`，等所有容器就绪；
4. 自动跑 prisma db push + 创建默认 admin；
5. 输出运行状态。

启动后访问 `https://你的域名.com`：
- 首屏正常 = 一切就绪
- 卡在 "证书申请失败" → 检查 DNS 是否生效、80/443 是否放通

---

## 六、上线后必做的安全清单

1. **改 admin 密码**：登录 `/login` → 后台 → 用户 → 修改自己的密码
2. **检查 `.env.prod` 权限**：
   ```bash
   chmod 600 .env.prod
   ```
3. **关掉 mock-pay**：`.env.prod` 里 `ENABLE_MOCK_PAY=false`（默认就是 false）
4. **配 IP 白名单**：把 `ADMIN_IP_ALLOWLIST` 收紧到你自己常用的 IP
5. **改 SSH 端口、禁用密码登录**（强烈推荐用 SSH key + Fail2ban）
6. **设置自动备份**：
   ```bash
   crontab -e
   # 每天凌晨 3 点备份，保留 30 天
   0 3 * * * /opt/polo/deploy/backup.sh >> /var/log/polo-backup.log 2>&1
   ```

---

## 七、对接支付宝（上线必看）

> **重要**：本项目支付宝凭据有两种配置方式，二选一：
>
> - **方式 A（推荐）**：`.env.prod` 里的 `ALIPAY_*` 全部留空，在管理后台「站点设置 → 支付宝」里填写。私钥/公钥会被 AES-GCM 加密入库，列表里不回显原值。
> - **方式 B**：直接写到 `.env.prod`。任何一个 `ALIPAY_*` 变量「为空」时会自动 fallback 到后台数据库设置。**只要 env 里写了非空值，就会覆盖后台**。
>
> 切记：**不要两边都填**，否则 env 永远赢。

### 7.1 在支付宝开放平台拿凭据

1. 登录 [open.alipay.com](https://open.alipay.com)（沙箱：[沙箱控制台](https://open.alipay.com/develop/sandbox/app)）。
2. **创建应用**：选「网页/移动应用」→ 应用类型选「自研」。
3. **开通接口能力**：应用详情 → 「能力列表」里至少添加：
   - `电脑网站支付`（用于 PC `alipay.trade.page.pay`）
   - `手机网站支付`（用于 H5 `alipay.trade.wap.pay`）
4. **生成密钥对（RSA2，2048 位）**：
   - 推荐用支付宝官方的「[密钥生成工具](https://opendocs.alipay.com/common/02kipl)」
   - 生成后会得到两个值：
     - `应用私钥`（PKCS1，本地保留，**永远不要传给支付宝**）→ 填到我们后台的「应用私钥」
     - `应用公钥`（上传到支付宝控制台 → 「开发设置 → 接口加签方式」）
   - 上传应用公钥后，支付宝会回显「**支付宝公钥**」字符串 → 填到我们后台的「支付宝公钥」
5. **不需要**在开放平台后台配置授权回调 / 异步通知地址 —— SDK 每次下单时会带 `notify_url` / `return_url` 参数。

### 7.2 在本项目后台配置

进入 `https://你的域名.com/admin/settings` → 切到「支付宝」Tab：

| 字段 | 填什么 |
| --- | --- |
| 启用支付宝 | 打开 |
| 使用沙箱 | 沙箱测试期打开；正式上线**关闭** |
| AppId | 开放平台应用的 APPID（沙箱是 `9021...` 开头） |
| 签名方式 | `RSA2` |
| 应用私钥 | 你本地生成的 PKCS1 私钥（一长串，去掉 `-----BEGIN/END-----` 标题行也行） |
| 支付宝公钥 | 上传应用公钥后支付宝回显的那一串 |
| 公网回调 Base URL | `https://你的域名.com`（**不带尾部斜杠，必填**） |

保存 → 后端会自动 `invalidate()` SDK 缓存，下一次创建订单时按新配置初始化。

### 7.3 验证

1. 前台随便挑个商品 → 下单 → 选「支付宝」→ 应该跳转到支付宝收银台（沙箱时跳沙箱版）。
2. 沙箱付款用沙箱买家账号（[沙箱账号列表](https://open.alipay.com/develop/sandbox/account)）。
3. 付款成功 → 自动跳回 `https://你的域名.com/order/{订单号}`，订单状态应该是「已发货」并展示卡密。
4. 看日志确认 notify 被支付宝调用了：
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api | grep alipay
   ```
   出现 `alipay notify: {...}` 和 `verifyNotify` 通过即正常。

### 7.4 常见故障

| 现象 | 原因 |
| --- | --- |
| 跳转支付宝时报「应用未配置」 | AppId 错 / 应用未上线（沙箱要切沙箱开关） |
| 收银台报「商户签名异常」 | 应用私钥不对，或私钥/公钥不是同一对 |
| 付款成功但订单一直 PENDING | `公网回调 Base URL` 错或不可达（支付宝服务器要能 POST 到 `/api/pay/alipay/notify`，本地调试要用 cpolar / ngrok / frp） |
| 报「签名验证失败」 | 后台填的「支付宝公钥」错了（注意是支付宝平台回显的那一串，不是你本地生成的「应用公钥」） |
| 金额不一致警告 | 用户改了 URL 参数，已被 notify 校验拦下，正常忽略 |

---

## 七·补、Cursorforge 兑换码下单 + 接验证码

本站点支持代理 Cursorforge OpenAPI 转售：管理员后台批量生成兑换码，终端用户输入兑换码 → 选商品 → 即时拿到账号。

### 7+.1 凭证 + IP 白名单（与接验证码共用）

凭证一对 `ak_xxx` / `sk_xxx`，已在「站点设置 → 接码接口」配置过的话，**这里直接共用**，无需重新配。

但要确认在 cursorforgeai 代理后台 → 开发者中心：

- **IP 白名单**：把你 VPS 出口 IP 加进去（在服务器上 `curl -4 ifconfig.me` 拿到）
- **scope**：至少包含 `email:code` 和下单权限（让平台运营给你开 `*` 通配最省事）
- **商品白名单**：联系运营把要卖的 type_key 加到「OpenAPI 出货」名单

### 7+.2 后台操作步骤

1. 登录 `https://你的域名.com/admin`
2. 左侧菜单 **Cursorforge → 三方商品** → 点右上角 **「从三方同步商品」**
   - 第一次同步会拉全部对你开放的商品到本地
   - 默认全部**未上架**（不会出现在用户兑换页）
3. 在列表里勾选要上架的商品，并设置 **售价 displayPrice**（CNY）
   - 默认填入 agent_price（你的成本价），手动改高就有利润
   - 改完失焦自动保存
4. 左侧菜单 **Cursorforge → 三方兑换码** → 点右上角 **「+ 批量生成」**
   - 面额：每张兑换码值多少元（CNY）
   - 数量：一次生成多少张
   - 过期时间：留空 = 永不过期
   - 生成后会弹出全部兑换码，可以「复制全部」分发给用户

### 7+.3 用户兑换流程

1. 用户访问首页 `https://你的域名.com` → 点击「使用兑换码下单」
2. 输入兑换码 → 看到余额 + 商品列表
3. 选商品 + 数量 → 「确认下单」
4. 跳转 `/forge-order/<订单号>` → 显示账号邮箱 + Token
5. 如果该商品支持接码，下方会自动出现「为该账号接验证码」卡片，点击即可轮询验证码

### 7+.4 关键设计

- **HMAC-SHA256 签名**：服务端把 ak/sk 持有，前端永远不接触 sk
- **AES-GCM 加密**：sk 入库加密，accounts（含 access_token）入库也加密
- **幂等键 `external_order_id`**：用我方订单号作三方幂等 ID，重复调用同 ID 不会重复出货
- **失败回滚**：三方下单失败 → 自动回滚兑换码已扣余额 + 订单标 FAILED + 显示错误码
- **一码可多次**：余额型兑换码（如 ¥50），用户可分次下不同商品直到耗尽
- **回看历史**：已用完的兑换码再次输入，会显示历史订单列表，可点进去重看 token

### 7+.5 常见错误

| 错误码 | 解决 |
| --- | --- |
| `AUTH_IP_NOT_ALLOWED` | 把当前服务器 IP 加到 cursorforgeai key 白名单 |
| `AUTH_IP_WHITELIST_REQUIRED` | key 没配白名单，cursorforgeai 后台编辑 key |
| `AUTH_BAD_SIGNATURE` | sk 错误，去本站「站点设置 → 接码接口」重填 |
| `PRODUCT_NOT_OPENAPI_ENABLED` | 联系 cursorforgeai 运营把该 type_key 加到「OpenAPI 出货」名单 |
| `INSUFFICIENT_BALANCE` | 你在 cursorforgeai 的代理余额不足，去充值 |
| `OUT_OF_STOCK` | 该商品三方缺货，再点一次「从三方同步商品」看库存最新值 |

---

## 八、日常运维

```bash
cd /opt/polo

# 看日志
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api

# 重启某个服务
docker compose -f docker-compose.prod.yml --env-file .env.prod restart api

# 进容器调试
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api sh

# 进 MySQL 命令行
docker compose -f docker-compose.prod.yml --env-file .env.prod exec mysql \
  mysql -upolo -p polo_faka
```

### 升级代码

```bash
cd /opt/polo
bash deploy/deploy.sh    # 自动 git pull + 重新 build + 重启
```

### 回滚

```bash
git log --oneline -5
git checkout <旧 commit>
bash deploy/deploy.sh
```

### 手动备份 / 恢复

```bash
# 备份
bash deploy/backup.sh

# 恢复（小心，会覆盖）
gunzip -c /var/backups/polo/polo_20260518_030000.sql.gz | \
  docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T mysql \
    mysql -upolo -p$(grep ^MYSQL_PASSWORD= .env.prod | cut -d= -f2) polo_faka
```

---

## 九、监控（可选）

最简单的方案：服务器上跑 [Uptime Kuma](https://github.com/louislam/uptime-kuma) 监控自己。

```bash
docker run -d --restart=always -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --name uptime-kuma louislam/uptime-kuma:1
```

监控目标加 `https://你的域名.com`、`https://你的域名.com/api/site-settings/public`，失败时邮件/Telegram/钉钉报警。

---

## 十、常见问题

### Q1: Caddy 一直起不来，证书申请失败

- DNS 还没生效：`dig +short 你的域名.com` 是否返回服务器 IP
- 80/443 没放通：`sudo ufw status` / 云服务商安全组
- Cloudflare 在用橙云代理：要么关 Cloudflare 代理（灰云），要么让 Caddy 用 DNS-01 challenge

### Q2: 首次 build 一直卡住、最后 OOM

- 服务器内存 ≤ 1G：在本机 build 镜像后用 `docker save / docker load` 推过去
- 或者：临时加 swap
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

### Q3: 想换数据库到外部托管（如 RDS / PlanetScale）

把 compose 里的 mysql 服务删掉，`.env.prod` 里改 `DATABASE_URL`：

```
DATABASE_URL=mysql://user:pwd@xxx.rds.amazonaws.com:3306/polo_faka
```

### Q4: 想关掉/打开 mock 支付方便自测

`.env.prod`：

```
ENABLE_MOCK_PAY=true   # 切到 true 后 docker compose restart api
```

### Q5: 站点访问慢

- 检查带宽是否打满：`iftop -i eth0`
- Caddy 已开 gzip + h2/h3，瓶颈大概率在国内 → 服务器线路
- 静态资源走 CDN：可以把 `apps/web/dist` 上传到对象存储 + CDN，nginx 改成只兜底 index.html

---

## 附：目录结构对照

```
/opt/polo/
├── docker-compose.prod.yml       # 生产编排
├── .env.prod                     # 生产环境变量（chmod 600）
├── deploy/
│   ├── Caddyfile                 # Caddy 配置
│   ├── init-server.sh            # 服务器初始化
│   ├── deploy.sh                 # 发布脚本
│   └── backup.sh                 # 数据库备份
├── apps/
│   ├── api/                      # NestJS 后端
│   │   ├── Dockerfile
│   │   └── scripts/
│   │       ├── entrypoint.sh
│   │       └── post-deploy.cjs
│   └── web/                      # Vue 前端
│       ├── Dockerfile
│       └── nginx.conf
└── DEPLOY.md                     # 本文件
```
