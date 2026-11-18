# 阶段 1 文件变更清单

相对 stage-0，本阶段的完整文件级变化如下。生成文件的职责只作定位，不需要逐行阅读。

| 变化 | 文件                                    | 作用/改动                                                                    |
| ---- | --------------------------------------- | ---------------------------------------------------------------------------- |
| 修改 | `README.md`                             | 当前阶段的运行入口与课程索引                                                 |
| 修改 | `apps/web/src/app/page.tsx`             | 当前教学阶段的最小首页，可通过代理验证 API。                                 |
| 修改 | `docs/README.md`                        | 截至本阶段的章节导航                                                         |
| 新增 | `docs/changes/stage-01.md`              | 本阶段学习文档或检查清单                                                     |
| 新增 | `docs/stage-01-domain-engine.md`        | 本阶段学习文档或检查清单                                                     |
| 修改 | `package.json`                          | 根命令、运行环境与开发工具                                                   |
| 新增 | `packages/bpm-core/src/engine.ts`       | 无副作用的串行流程引擎：给定快照、当前位置和表单，计算下一个人工节点或终点。 |
| 修改 | `packages/bpm-core/src/index.ts`        | 共享包的唯一公共入口；前后端通过它依赖模型与引擎，不互相依赖。               |
| 新增 | `packages/bpm-core/src/templates.ts`    | 内置模板工厂：返回全新的流程、连线与表单对象。                               |
| 新增 | `packages/bpm-core/src/types.ts`        | 业务模型与运行时校验协议。                                                   |
| 新增 | `packages/bpm-core/src/validation.ts`   | 发布前图校验与提交时表单校验。                                               |
| 新增 | `packages/bpm-core/test/engine.test.ts` | 纯引擎测试：不依赖浏览器或数据库。                                           |
