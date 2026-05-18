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

## 七、对接支付宝

1. 登录支付宝开放平台 → 创建网页/移动应用，拿到 `APPID`、`商户私钥`、`支付宝公钥`
2. 网关回调地址填：`https://你的域名.com/api/pay/alipay/notify`
3. 同步返回地址：`https://你的域名.com/api/pay/alipay/return`
4. 进入站点后台 → **站点设置 → 支付宝** 标签页填写并保存
   - 私钥/公钥会被 AES-GCM 加密入库，**列表里不再回显原值**
5. 测试：随便买个商品，确认走支付宝 → 付款成功后自动发货

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
