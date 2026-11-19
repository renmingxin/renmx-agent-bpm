# 阶段 6 文件变更清单

相对 `stage-5`，本阶段的文件级变化如下。既有阶段标签保持不变；生成的 next-env.d.ts 不纳入本次手写变更。

| 变化 | 文件                                                    | 职责/改动                                                                  |
| ---- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| 修改 | `.env.example`                                          | 双模型 provider 与独立 Embedding 配置示例                                  |
| 修改 | `README.md`                                             | 五项能力、模型配置与 stage-6 总入口                                        |
| 修改 | `apps/api/package.json`                                 | 新增模型/解析依赖；测试按文件串行避免共享测试库冲突                        |
| 修改 | `apps/api/src/app.module.ts`                            | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/api/src/assistant/assistant.controller.ts`        | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/api/src/assistant/assistant.service.ts`           | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/api/src/assistant/model-gateway.ts`               | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/api/src/assistant/output-schema.ts`               | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/api/src/assistant/policy.service.ts`              | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/api/src/assistant/prompts.ts`                     | 助手协议、界面或依赖配置                                                   |
| 修改 | `apps/api/src/main.ts`                                  | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/api/test/assistant.test.ts`                       | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/web/src/app/assistant/page.tsx`                   | 制度中心路由薄入口：管理/检索交互由 KnowledgePage 承担。                   |
| 修改 | `apps/web/src/app/globals.css`                          | 样式入口：按基础 → 页面 → 响应式的顺序加载，保证覆盖关系清晰。             |
| 新增 | `apps/web/src/components/assistant/assistant-panel.tsx` | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/web/src/components/assistant/knowledge-page.tsx`  | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/web/src/components/assistant/model-picker.tsx`    | 助手协议、界面或依赖配置                                                   |
| 修改 | `apps/web/src/components/form-fields.tsx`               | 助手协议、界面或依赖配置                                                   |
| 修改 | `apps/web/src/components/runtime/instance-detail.tsx`   | 助手协议、界面或依赖配置                                                   |
| 修改 | `apps/web/src/components/runtime/start-process.tsx`     | 助手协议、界面或依赖配置                                                   |
| 修改 | `apps/web/src/components/shell.tsx`                     | 助手协议、界面或依赖配置                                                   |
| 新增 | `apps/web/src/styles/assistant.css`                     | 智能助手与制度库：结果按事实/规则/生成建议区分，旧结果用文字说明过期状态。 |
| 修改 | `docs/README.md`                                        | 新增课程与助手运行导航                                                     |
| 新增 | `docs/agent/README.md`                                  | 总体规划注明已实现五项与未来能力                                           |
| 新增 | `docs/agent/architecture.md`                            | 保留总体方案，明确与当前实现的差别                                         |
| 新增 | `docs/agent/implementation-plan.md`                     | 区分实际 stage-6 与未来概念路线                                            |
| 新增 | `docs/agent/setup.md`                                   | 模型选择、RAG 配置与五项功能体验说明                                       |
| 新增 | `docs/changes/stage-06.md`                              | 本阶段完整文件变更清单                                                     |
| 修改 | `docs/configuration.md`                                 | 新增模型变量、依赖与 Turbo 传递规则                                        |
| 新增 | `docs/examples/expense-policy.md`                       | 合成演示制度，用于检索引用验收                                             |
| 新增 | `docs/stage-06-approval-assistant.md`                   | 第 6 章原理、阅读顺序、验证、练习与常见问题                                |
| 修改 | `overview.md`                                           | 助手边界、历史体检与真实验收记录                                           |
| 新增 | `packages/bpm-core/src/assistant-checks.ts`             | 助手协议、界面或依赖配置                                                   |
| 新增 | `packages/bpm-core/src/assistant.ts`                    | 助手协议、界面或依赖配置                                                   |
| 修改 | `packages/bpm-core/src/index.ts`                        | 共享包的唯一公共入口；前后端通过它依赖模型与引擎，不互相依赖。             |
| 新增 | `packages/bpm-core/test/assistant.test.ts`              | 助手规则的业务边界测试：金额临界值、字段异常与实际/模拟路线隔离。          |
| 修改 | `pnpm-lock.yaml`                                        | 固定新增 LangChain/文档解析依赖                                            |
| 修改 | `pnpm-workspace.yaml`                                   | 总是引用本地包。                                                           |
| 修改 | `turbo.json`                                            | 向开发子进程传递模型与服务端环境变量                                       |
