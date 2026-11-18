# 流序 Flowline · 简易 BPM 工作流

一个可以画流程、发布、填写表单并完成审批流转的学习型工程。

技术栈：**Next.js + React + @xyflow/react + NestJS + PostgreSQL 18 + Docker Compose + pnpm workspace + Turborepo + TypeScript**。

## 先体验，再读源码

需要 Node.js 24+、pnpm 12.11.2，以及运行中的 Docker Desktop。

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:up
pnpm dev
```

打开 [工作台](http://127.0.0.1:3000)。已有 `.env` 时保留自己的配置，不要重复覆盖。

| 服务       | 地址/端口                          | 用途                                    |
| ---------- | ---------------------------------- | --------------------------------------- |
| Next.js    | `http://127.0.0.1:3000`            | 工作台、表单和流程设计器，代理 `/api/*` |
| NestJS     | `http://127.0.0.1:4000/api/health` | 业务与审批 API                          |
| PostgreSQL | `127.0.0.1:5440`                   | `bpm` 业务库与 `bpm_test` 测试库        |

第一次启动空库会生成费用报销、请假、采购三个模板和六份示例申请。之后重启保留现有数据。

体验完整链路：右上角切换 **林晓** → 发起 4200 元报销 → 切换 **陈亦舟** 同意 → 自动判断金额 → 切换 **王知远** 同意 → 申请完成。1000 元申请在部门负责人同意后直接完成。

## 能做什么

- 设计态：添加/拖拽/连接/删除节点，自动排列，配置审批人与数字条件分支。
- 表单设计：文本、多行文本、数字、日期、下拉选择，必填、选项与顺序配置。
- 流程管理：草稿保存、发布版本、复制流程、启停。
- 运行态：填写申请、待办/已办/我的申请、搜索筛选、审批修订表单、同意与驳回。
- 可靠性：服务端校验、发布图校验、版本快照、revision 防覆盖、PostgreSQL 事务/行锁、任务唯一约束和审计历史。

这是本地教学版。身份切换是演示机制，正式使用前需要接入认证/授权。引擎支持串行审批与数值条件 DAG，不包含并行会签、退回重提、BPMN 导入导出或多租户。

## 推荐阅读顺序

先运行上面的完整链路，再从第 0 章开始。**不要一上来读架构文档**，先从一份申请如何经过代码建立直觉。

| 阶段                                      | 主题                  | 新概念                              | 可运行效果           | 代码快照  |
| ----------------------------------------- | --------------------- | ----------------------------------- | -------------------- | --------- |
| [0](docs/stage-00-workspace.md)           | Monorepo 与启动链路   | workspace、Turbo、Next 代理、Docker | 最小首页与健康接口   | `stage-0` |
| [1](docs/stage-01-domain-engine.md)       | 共享模型与纯引擎      | 定义/实例/任务、图、条件与校验      | 无数据库运行引擎测试 | `stage-1` |
| [2](docs/stage-02-postgres-api.md)        | PostgreSQL 与业务 API | JSONB、事务、行锁、发布快照         | HTTP 完成完整流转    | `stage-2` |
| [3](docs/stage-03-runtime-workbench.md)   | 表单与工作台          | 客户端边界、派生状态、动态表单      | 浏览器填写和审批     | `stage-3` |
| [4](docs/stage-04-visual-designer.md)     | 可视化设计器          | 受控画布、handle、设计/运行分离     | 画图、配置表单、发布 | `stage-4` |
| [5](docs/stage-05-tests-and-extension.md) | 验证与扩展            | 不变量、并发测试、系统边界          | 完整测试与交付检查   | `stage-5` |

每章都含阅读顺序、重点、验证命令、练习、常见问题和文件变更清单。源码有职责注释，关键算法和事务有行内解释；JSON 配置见 [配置指南](docs/configuration.md)。

阶段是按依赖关系重组的教学快照，并非对原始开发时间线的逐次记录；早期快照只含截至当章的代码和文档。切换前停止开发服务，先保存自己的学习修改：

```powershell
git switch --detach stage-2
pnpm install --frozen-lockfile
pnpm dev
# 回到完整版本
git switch main
pnpm install --frozen-lockfile
```

## 目录与常用命令

```text
apps/web/src/
  app/                    Next 路由薄入口
  components/designer/    流程画布、节点、属性与表单设计
  components/runtime/     发起申请、审批详情与路线说明
  components/             工作台、流程列表、表单与公共 UI
  lib/                    Context、请求与时间工具
  styles/                 按页面职责拆分的 CSS
apps/api/src/             控制器、应用服务、PostgreSQL 仓储、迁移与种子
packages/bpm-core/src/    模型、模板、校验与无副作用引擎
docs/                    分阶段课程、配置说明、架构与变更清单
docker/                  首次数据库初始化
scripts/                 注释检查
```

```powershell
pnpm db:up          # 启动数据库并等待健康
pnpm db:down        # 停止数据库，保留数据卷
pnpm typecheck     # 全工程类型检查
pnpm test          # 核心单元测试 + 独立 PostgreSQL 测试库 + HTTP 测试
pnpm comments:check
pnpm format:check
pnpm build
pnpm start         # build 后启动两个生产进程
```

更详细的 [重启与排错](docs/startup.md)、[系统架构](docs/architecture.md)、[验证记录](overview.md)。项目参考了提供的 aiflow 的 apps/packages 分层、独立引擎和发布快照思路，代码独立编写，未修改参考项目。
