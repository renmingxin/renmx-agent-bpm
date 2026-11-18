# Flowline · 阶段 3

当前主题：表单与运行工作台。这是逐阶段累加的教学快照，不是原开发时间线。

## 启动

需要 Node 24+、pnpm 12.11.2 和 Docker。

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm dev
```

页面 http://127.0.0.1:3000，API 4000，PostgreSQL 5440。可选根 .env 见 .env.example。

## 推荐阅读顺序

| 阶段 | 主题                  | 文档                                       | tag       |
| ---- | --------------------- | ------------------------------------------ | --------- |
| 0    | Monorepo 与启动链路   | [阅读](docs/stage-00-workspace.md)         | `stage-0` |
| 1    | 共享模型与纯引擎      | [阅读](docs/stage-01-domain-engine.md)     | `stage-1` |
| 2    | PostgreSQL 与业务 API | [阅读](docs/stage-02-postgres-api.md)      | `stage-2` |
| 3    | 表单与运行工作台      | [阅读](docs/stage-03-runtime-workbench.md) | `stage-3` |

先读本阶段文档再读代码，暂时不要从架构总图开始。当前快照只提供截至本章的功能。
