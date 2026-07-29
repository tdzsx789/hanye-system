# 汉业运输管理系统

这个目录是从原项目整理出来的干净版：

- `web/`：前端 Vue/Vite 项目。
- `server/`：后端 Express API，生产环境连接 PostgreSQL。

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

## 服务器/1Panel 部署建议

在服务器上使用同一份 `docker-compose.yml`：

1. 在面板里新建编排/应用，把项目文件上传到服务器。
2. 根据 `.env.example` 设置 `.env`，生产环境务必修改 `POSTGRES_PASSWORD`。
3. 把 `WEB_PORT` 改成需要暴露的端口，或交给面板/Nginx 反向代理绑定域名。
4. 设置容器自动重启，保持 `postgres_data` volume 不删除。
5. 开启 PostgreSQL 定时备份；更高要求的灾备建议使用云数据库高可用或主从 PostgreSQL，而不是只依赖单机容器。
