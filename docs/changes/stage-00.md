# 阶段 0 文件变更清单

相对空仓库，本阶段的完整文件级变化如下。生成文件的职责只作定位，不需要逐行阅读。

| 变化 | 文件                                        | 作用/改动                                                      |
| ---- | ------------------------------------------- | -------------------------------------------------------------- |
| 新增 | `.env.example`                              | 本地数据库与代理地址示例                                       |
| 新增 | `.gitignore`                                | 排除运行数据、依赖与缓存                                       |
| 新增 | `.prettierignore`                           | 排除格式化生成物                                               |
| 新增 | `.prettierrc.json`                          | 代码排版约定                                                   |
| 新增 | `README.md`                                 | 当前阶段的运行入口与课程索引                                   |
| 新增 | `apps/api/package.json`                     | 子包命令和依赖声明                                             |
| 新增 | `apps/api/src/main.ts`                      | 阶段 0 的最小 Nest 入口；数据库连接和业务接口在后续章节引入。  |
| 新增 | `apps/api/tsconfig.json`                    | 子包编译边界与输出配置                                         |
| 新增 | `apps/web/next-env.d.ts`                    | Next 生成的框架类型入口                                        |
| 新增 | `apps/web/next.config.ts`                   | Next.js 配置：共享包参与编译，/api 请求由 Next 代理到 NestJS。 |
| 新增 | `apps/web/package.json`                     | 子包命令和依赖声明                                             |
| 新增 | `apps/web/src/app/globals.css`              | 最小课程页面样式，完整布局在运行态章节加入。                   |
| 新增 | `apps/web/src/app/layout.tsx`               | 最小根布局：先理解路由入口，复杂外壳在运行态章节加入。         |
| 新增 | `apps/web/src/app/page.tsx`                 | 当前教学阶段的最小首页，可通过代理验证 API。                   |
| 新增 | `apps/web/tsconfig.json`                    | 子包编译边界与输出配置                                         |
| 新增 | `docker-compose.yml`                        | 独立 PostgreSQL 容器、端口、卷和健康检查                       |
| 新增 | `docker/postgres/init/01-test-database.sql` | 本阶段实现与职责注释                                           |
| 新增 | `docs/README.md`                            | 截至本阶段的章节导航                                           |
| 新增 | `docs/changes/stage-00.md`                  | 本阶段学习文档或检查清单                                       |
| 新增 | `docs/configuration.md`                     | 本阶段学习文档或检查清单                                       |
| 新增 | `docs/stage-00-workspace.md`                | 本阶段学习文档或检查清单                                       |
| 新增 | `docs/startup.md`                           | 本阶段学习文档或检查清单                                       |
| 新增 | `package.json`                              | 根命令、运行环境与开发工具                                     |
| 新增 | `packages/bpm-core/package.json`            | 子包命令和依赖声明                                             |
| 新增 | `packages/bpm-core/src/index.ts`            | 阶段 0 的共享包占位；先验证包依赖与构建链路。                  |
| 新增 | `packages/bpm-core/tsconfig.json`           | 子包编译边界与输出配置                                         |
| 新增 | `pnpm-lock.yaml`                            | 可复现的依赖解析（工具生成）                                   |
| 新增 | `pnpm-workspace.yaml`                       | 应用/共享包边界及安装脚本策略                                  |
| 新增 | `tsconfig.base.json`                        | 共享严格类型约定                                               |
| 新增 | `turbo.json`                                | 构建依赖顺序与缓存策略                                         |
