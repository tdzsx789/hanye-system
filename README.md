# 汉业运输管理系统

这个目录是从原项目整理出来的干净版：

- `web/`：前端 Vue/Vite 项目。
- `server/`：后端 Express API，生产环境连接 PostgreSQL。
- `mobile/`：原生微信小程序端，给跟单员在外移动排车/派车使用。

## 小程序端

`mobile/` 已加入微信小程序原生工程，排车表功能复用现有 `/api/dispatch-plans`、`/api/orders`、`/api/customers`、`/api/vehicles`、`/api/drivers` 接口。用微信开发者工具打开 `mobile/` 后，可在登录页配置服务器 API 地址；生产上线需改正式 AppID，并在微信公众平台配置 HTTPS request 合法域名。

## 本地开发启动

后端现在使用 PostgreSQL。本地开发时需要先准备 PostgreSQL，并设置以下环境变量；最简单的方式是只启动 compose 里的数据库：

```bash
docker compose up -d postgres
```

分别打开两个终端：

```bash
cd /Users/tree/Desktop/code/hanye-system/server
npm install
PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=hanye PGUSER=hanye PGPASSWORD=hanye_dev_password \
npm run dev
```

```bash
cd /Users/tree/Desktop/code/hanye-system/web
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:5173/
```

后端 API 默认：

```text
http://127.0.0.1:5174/api
```

如果 `5174` 被占用，可以这样启动：

```bash
cd /Users/tree/Desktop/code/hanye-system/server
PORT=5175 npm run dev
```

```bash
cd /Users/tree/Desktop/code/hanye-system/web
VITE_API_TARGET=http://127.0.0.1:5175 npm run dev
```

## Docker 本地联调

Docker 模式会启动四个核心容器：

- `web`：Nginx 托管前端静态文件，并把 `/api` 代理给后端。
- `server` / `server-standby`：两个 Express API 容器，主后端不可用时 Nginx 会切到备用后端。
- `postgres`：PostgreSQL 16 数据库。

复制环境变量模板：

```bash
cp .env.example .env
```

`SEED_DEMO_DATA` 默认是 `0`，正式环境请保持关闭；只有需要给一个空库自动补演示数据时才改成 `1`。

启动：

```bash
npm run docker:up
```

默认访问：

```text
http://127.0.0.1:8080/
```

查看日志：

```bash
npm run docker:logs
```

停止容器：

```bash
npm run docker:down
```

## PostgreSQL 备份

默认 Docker 编排已准备 `postgres-backup` 可选 profile。需要本地启用定时备份时运行：

```bash
docker compose --profile backup up -d postgres-backup
```

备份文件会写入 Docker volume `postgres_backups`，默认保留 14 天。部署到 1Panel 或类似面板时，建议同时开启面板自带的数据库定时备份，并把备份目录同步到另一台机器或对象存储。

## OSS 附件存储

系统附件统一保存到阿里云 OSS。配置完整后，新上传的客户附件、订单附件、车辆证件、司机证件会写入 OSS，PostgreSQL `files` 表只保存文件名、大小、类型和 OSS object key 等元数据，不再保存文件正文。历史上已经存入 `files.content_base64` 的附件会在后端启动时自动迁移到 OSS，迁移成功后清空数据库正文。

未配置 OSS 时，附件上传、预览和下载会被禁用；系统不会再退回 PostgreSQL 保存附件正文。

建议 Bucket 权限保持私有，AccessKey 使用 RAM 用户，并只授予目标 Bucket 的 `oss:PutObject`、`oss:GetObject`、`oss:DeleteObject` 权限。

在 `.env` 或 1Panel 编排环境变量里填写：

```env
OSS_BUCKET=你的Bucket名称
OSS_REGION=oss-cn-shenzhen
OSS_ACCESS_KEY_ID=你的AccessKeyId
OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
OSS_KEY_PREFIX=hanye-system/uploads
OSS_SIGNED_URL_EXPIRES_SECONDS=3600
```

如果应用服务器 ECS 和 Bucket 在同一地域，可以开启内网访问：

```env
OSS_INTERNAL=1
```

如果使用自定义域名、加速域名或明确的 endpoint，可以填写：

```env
OSS_ENDPOINT=oss-cn-shenzhen.aliyuncs.com
```

上线后访问 `/api/health`，返回里的 `fileStorage` 为 `oss` 表示后端已经启用 OSS；如果是 `oss-unconfigured`，说明 OSS 环境变量没有填完整，附件功能会暂停。

## 服务器/1Panel 部署建议

在服务器上使用同一份 `docker-compose.yml`：

1. 在面板里新建编排/应用，把项目文件上传到服务器。
2. 根据 `.env.example` 设置 `.env`，生产环境务必修改 `POSTGRES_PASSWORD`，保持 `SEED_DEMO_DATA=0`，并填写 OSS 变量。
3. 把 `WEB_PORT` 改成需要暴露的端口，或交给面板/Nginx 反向代理绑定域名。
4. 设置容器自动重启，保持 `postgres_data` volume 不删除。
5. 开启 PostgreSQL 定时备份；更高要求的灾备建议使用云数据库高可用或主从 PostgreSQL，而不是只依赖单机容器。

## 阿里云 ECS 一键覆盖部署

当前服务器已有站点占用 `80/443` 时，不需要改动现有 Nginx。`hanye-system` 可独立暴露到 `8081`，后端 `5174` 和 PostgreSQL `5432` 只在 Docker 内网使用，不需要对公网开放。

本机部署到 ECS：

```bash
bash scripts/deploy-ecs.sh
```

脚本默认配置：

```text
ECS_HOST=120.24.163.215
ECS_USER=root
ECS_PORT=22
ECS_KEY=~/.ssh/hanye_ecs_codex
REMOTE_DIR=/opt/hanye-system
WEB_PORT=8081
ENABLE_BACKUP=1
```

脚本会使用 `rsync --delete` 覆盖服务器代码，但会排除 `.env`、`.git`、`node_modules`、构建产物和本地 SQLite 文件；服务器上的 PostgreSQL Docker volume 不会被删除。部署完成后访问：

```text
http://120.24.163.215:8081/
```

以后如果要换服务器或端口，可以临时覆盖变量：

```bash
ECS_HOST=你的服务器IP WEB_PORT=8082 bash scripts/deploy-ecs.sh
```
