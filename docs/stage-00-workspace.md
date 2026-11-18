# 阶段 0 · 先跑通 monorepo

> 代码快照：`stage-0`。本章不需要阅读业务算法。

## 一、本阶段目标

能说明浏览器、Next.js、NestJS 与 Docker 各自做什么，并独立启动两个应用。阶段快照首页是最小课程页面，`/api/health` 经由 Next 代理返回 JSON。

## 二、新引入的概念

**Monorepo** 是把多个应用和共享库放进一个仓库，而不是把它们都塞进一个应用。`apps/web` 面向浏览器，`apps/api` 面向业务请求，`packages/bpm-core` 将来容纳双方的公共协议。pnpm 负责包链接，Turbo 负责按依赖顺序运行命令。

**代理** 解决浏览器如何找到 API。页面请求 `3000/api/health`，Next 转发到 `4000/api/health`；4000 负责业务，3000 负责页面。数据库不应暴露给浏览器。

**Docker 卷** 保存数据库文件。容器可以停止再启动，卷中的数据仍在。`docker compose down` 保留卷；学习时不要为了重启而删除卷。

## 三、按这个顺序阅读代码

1. 根 `package.json`：跟着 `dev` 看“先编译 core，再启动 Turbo”。
2. `pnpm-workspace.yaml`：找出三个包的边界；子包名称与目录名并不要求相同。
3. `turbo.json`：解释 `^build`，想一想 web 为什么不能先于 core 构建。
4. `apps/web/next.config.ts`：画出 `/api/health` 的转发路线。
5. `apps/api/src/main.ts`：从 `NestFactory.create` 跟到 `app.listen`。
6. `docker-compose.yml` 与 `.env.example`：标出宿主机 5440 与容器 5432。
7. [配置逐项说明](configuration.md)：遇到配置项再查，不必全部背下来。

**重点**：先建立进程和端口的概念。`workspace:*` 是包依赖，`rewrites` 是网络请求转发，两者解决的问题不同。

## 四、如何验证与练习

在仓库根目录打开 PowerShell：

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:up
pnpm dev
```

另开终端执行：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
docker compose ps
```

预期 API 返回 `ok: true`，数据库显示 `healthy`。阶段 0 只验证应用骨架，API 的数据库连接在阶段 2 引入。

练习：把 API 端口改为 4001，同步 `API_URL`，重启后仍能通过 3000 访问健康检查。完成后恢复默认值。

## 五、常见问题

- **启动时报 core 的 dist 不存在**：不要绕过根脚本单独启动依赖方；根 `pnpm dev` 会先构建 core。
- **pnpm 提示 esbuild 安装脚本被忽略**：仓库已经精确声明 `allowBuilds.esbuild`，在根目录重新 `pnpm install`。
- **已有 aiflow 占用 PostgreSQL 端口**：本工程使用 5440，容器、网络和卷也独立，不需要停止原项目。
- **切换阶段后依赖不一致**：先停止 dev，再切 tag，重新安装依赖。自己的学习修改应先提交到学习分支。

## 六、本阶段文件变更清单

新增根目录包管理、Turbo、TypeScript、格式化配置和 Docker Compose；新增两个应用的包配置与最小启动入口；新增共享包占位入口、本章和配置说明。完整的逐文件列表由 `docs/changes/stage-00.md` 记录。
