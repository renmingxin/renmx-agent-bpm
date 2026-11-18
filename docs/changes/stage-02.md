# 阶段 2 文件变更清单

相对 stage-1，本阶段的完整文件级变化如下。生成文件的职责只作定位，不需要逐行阅读。

| 变化 | 文件                              | 作用/改动                                                                         |
| ---- | --------------------------------- | --------------------------------------------------------------------------------- |
| 修改 | `README.md`                       | 当前阶段的运行入口与课程索引                                                      |
| 新增 | `apps/api/src/app.module.ts`      | NestJS 依赖注册表：Controller 接收 HTTP，Service 编排业务，Store 提供数据库连接。 |
| 新增 | `apps/api/src/bpm.controller.ts`  | HTTP 边界：解析路径、演示身份和 JSON 请求，调用共享 Zod schema 后交给应用服务。   |
| 新增 | `apps/api/src/bpm.service.ts`     | 应用服务把纯引擎计算转化为持久化业务操作。                                        |
| 新增 | `apps/api/src/database/schema.ts` | 初始迁移：JSONB 容纳可变的流程定义和运行快照。                                    |
| 新增 | `apps/api/src/error.filter.ts`    | 统一异常输出：Zod → 400，Nest 业务异常 → 对应 4xx，未知错误 → 500。               |
| 修改 | `apps/api/src/main.ts`            | NestJS 进程入口。                                                                 |
| 新增 | `apps/api/src/seed.ts`            | 首次启动演示数据：只初始化空库，不覆盖已有流程。                                  |
| 新增 | `apps/api/src/store.ts`           | PostgreSQL 仓储：Repository 封装查询，Store 管理连接池和事务。                    |
| 修改 | `apps/web/src/app/page.tsx`       | 当前教学阶段的最小首页，可通过代理验证 API。                                      |
| 修改 | `docs/README.md`                  | 截至本阶段的章节导航                                                              |
| 新增 | `docs/changes/stage-02.md`        | 本阶段学习文档或检查清单                                                          |
| 新增 | `docs/stage-02-postgres-api.md`   | 本阶段学习文档或检查清单                                                          |
