# 启动、重启与排错

## 重启电脑后

1. 打开 Docker Desktop，等待引擎就绪。
2. 在本仓库根目录执行 `pnpm db:up`，等待 postgres healthy。
3. 执行 `pnpm dev`，保持该终端运行。
4. 打开 `http://127.0.0.1:3000`。

第一次需要 `pnpm install`。需要自定义环境时复制根 `.env.example` 为 `.env`；已有 `.env` 不覆盖。Next 配置和 Nest 入口都会读取根环境文件。

| 项目                | 默认值   | 修改位置                                   |
| ------------------- | -------- | ------------------------------------------ |
| 页面                | 3000     | `apps/web/package.json` 的 Next 启动参数   |
| API                 | 4000     | 根 `.env` 的 API_PORT，同时改 API_URL      |
| PostgreSQL 宿主端口 | 5440     | POSTGRES_PORT 与两个数据库 URL             |
| 容器内 PostgreSQL   | 5432     | Compose ports 右侧，一般不用改             |
| 业务库              | bpm      | DATABASE_URL                               |
| 独立测试库          | bpm_test | TEST_DATABASE_URL，库名必须以 `_test` 结尾 |

默认用户 `bpm`、密码 `bpm_dev_password` 仅供本地开发。数据库只绑定 `127.0.0.1`。修改已有卷的环境变量不会自动修改 PostgreSQL 内的用户密码。

## 检查服务

```powershell
docker compose ps
Invoke-RestMethod http://127.0.0.1:4000/api/health
Invoke-RestMethod http://127.0.0.1:3000/api/health
docker compose exec postgres psql -U bpm -d bpm -c '\dt'
```

`pnpm db:logs` 查看数据库日志。`pnpm db:down` 停止服务并保留命名卷；再次 `db:up` 后数据仍在。不要把删除卷当作日常重启步骤。

## 常见问题

- **Docker 未运行**：先启动 Desktop，再执行 db:up；不要修改业务代码解决守护进程连接失败。
- **端口占用**：不要停止其他项目的容器。本项目默认刻意避开了现有 aiflow 的 5433/5438。
- **测试库不存在**：init SQL 只在空卷首次执行。可运行 `docker compose exec postgres psql -U bpm -d bpm -c 'CREATE DATABASE bpm_test;'` 创建测试库，然后重试；数据库已存在时不重复执行。
- **API 500/代理不可用**：先看 Nest 终端是否启动，再分别检查 4000 和 3000 健康接口；若只有 3000 失败，核对 API_URL。
- **新开终端 pnpm 版本不同**：使用项目声明的 pnpm 12.11.2，并确认 Node 24+。
- **阶段切换后编译异常**：停止 dev，重新安装依赖；先执行 `pnpm build` 重新生成共享包与 Next 路由类型，再启动。
- **403**：当前身份不是节点指定人，右上角切到对应审批人。409 表示版本或任务状态已经变化，应刷新后查看。
- **看不到其他人的新申请**：当前工作台按身份筛选；点击刷新重新读取，或切到“全部申请”。本版没有 WebSocket 实时推送。
