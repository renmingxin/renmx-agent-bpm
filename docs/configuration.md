# 配置文件阅读指南

JSON 配置必须符合标准语法，不能插入 `//` 或 `/* */` 注释。本页逐项解释配置；TypeScript、CSS、YAML、SQL 和脚本本身带有职责注释。`pnpm-lock.yaml`、`next-env.d.ts`、`dist/` 和 `.next/` 是工具生成内容，不应手动加注释。

| 文件                              | 重点                                              | 为什么这样配置                                                      |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| 根 `package.json`                 | `private`、`packageManager`、`engines`            | 禁止误发 npm 包；固定 pnpm；使用 Node 24+                           |
| 根 `package.json`                 | `dev`                                             | 先编译共享包，再让 Turbo 同时启动三个 watcher                       |
| 根 `package.json`                 | `db:up` / `db:down`                               | 启动并等待数据库健康；停止时保留命名卷                              |
| 根 `package.json`                 | `test`                                            | 核心引擎单元测试与真实 PostgreSQL 集成测试分开执行                  |
| `pnpm-workspace.yaml`             | `apps/*`、`packages/*`                            | 建立本地包依赖关系；不通过相对路径跨应用引用源码                    |
| `pnpm-workspace.yaml`             | `allowBuilds.esbuild`                             | 允许 tsx 使用的 esbuild 安装其平台二进制；没有全局放开安装脚本      |
| `turbo.json`                      | `build.dependsOn: ['^build']`                     | 先生成 `@bpm/core/dist`，再构建依赖它的前后端                       |
| `turbo.json`                      | `dev.persistent` / `cache:false`                  | dev 是常驻进程，不能把启动日志当成缓存结果                          |
| `turbo.json`                      | `outputs`                                         | 只缓存构建结果，不缓存 Next 的临时缓存目录                          |
| `turbo.json`                      | `globalDependencies` / `globalEnv`                | 根类型配置、连接配置和 API 代理地址变化时让缓存失效，避免复用旧构建 |
| `tsconfig.base.json`              | `strict`                                          | 在编译期发现缺少字段、可能为空和错误的状态类型                      |
| `tsconfig.base.json`              | `noUnusedLocals` / `noUnusedParameters`           | 阻止未使用的变量和参数进入教学源码，减少阅读干扰                    |
| `packages/bpm-core/tsconfig.json` | `declaration`、`rootDir`、`outDir`                | 输出 JS 与类型声明；前后端读取同一份公共包                          |
| `apps/api/tsconfig.json`          | `experimentalDecorators`、`emitDecoratorMetadata` | 支持 Nest 装饰器；源码还使用显式 `@Inject`，兼容 tsx 开发模式       |
| `apps/web/tsconfig.json`          | `moduleResolution: Bundler`、`jsx`、`paths`       | 交给 Next 处理模块与 JSX；`@/` 仅是当前 web 应用内的路径别名        |
| `apps/web/next.config.ts`         | `transpilePackages`                               | 让共享包参与 Next 编译                                              |
| `apps/web/next.config.ts`         | `rewrites`                                        | 浏览器访问 `/api/*`，Next 代理到 Nest，不需要浏览器直连 4000        |
| 三个子包的 `package.json`         | `@bpm/core: workspace:*`                          | 强制使用当前仓库的核心包，避免前后端模型版本不一致                  |
| `.prettierrc.json`                | `singleQuote`、`printWidth`                       | 统一代码排版，避免 JSX 挤在一行，便于逐段阅读                       |
| `.prettierignore` / `.gitignore`  | 生成物与 `.env`                                   | 不格式化依赖、不提交凭据与数据库数据                                |
| `.env.example`                    | 两个数据库 URL                                    | `bpm` 保存体验数据，`bpm_test` 专供测试重置                         |
| `docker-compose.yml`              | 5440、healthcheck、命名卷                         | 避开本机已有数据库；等待可连接后再启动 API；重启仍保留数据          |

`DATABASE_URL` 给 API 使用，`API_URL` 给 Next 的代理使用，`POSTGRES_PORT` 给 Compose 的宿主机端口使用。修改端口时必须把这三个位置对应起来；修改数据库密码时也要同步两个数据库 URL。已有数据卷不会因为修改 `POSTGRES_PASSWORD` 自动更新数据库内的密码。

默认开发脚本读取仓库根目录 `.env`。不复制也能用默认端口启动。自定义环境变量后需要重新启动开发进程。
