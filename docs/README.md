# 分阶段学习入口

先体验一份申请，再从第 0 章阅读。每章都包含目标、原理、代码顺序、验证、练习和文件变更清单。

- [阶段 0 · Monorepo 与启动链路](stage-00-workspace.md) · `stage-0`
- [阶段 1 · 共享模型与纯引擎](stage-01-domain-engine.md) · `stage-1`
- [阶段 2 · PostgreSQL 与业务 API](stage-02-postgres-api.md) · `stage-2`
- [阶段 3 · 表单与运行工作台](stage-03-runtime-workbench.md) · `stage-3`
- [阶段 4 · 可视化设计器与发布](stage-04-visual-designer.md) · `stage-4`
- [阶段 5 · 并发验证与扩展边界](stage-05-tests-and-extension.md) · `stage-5`
- [阶段 6 · LangGraph 审批助手与制度 RAG](stage-06-approval-assistant.md) · `stage-6`

配置不明白时查 [配置指南](configuration.md)，重启时查 [启动说明](startup.md)。

## 智能审批助手

五项能力已在 `stage-6` 实现。先看 [运行与模型配置](agent/setup.md)，再跟随第 6 章阅读代码。下面三份是总体规划，包含尚未实现的后续能力：

零基础读者可直接进入 [五项能力的链路课程](agent/learning/README.md)。它按当前代码逐步讲解，包含术语入门、五条能力的独立章节、RAG 双链路、Qwen 填单问题与动手实验，建议先于下面的架构规划阅读。

1. [功能规划与首版范围](agent/README.md)：申请人、审批人、流程设计者和管理者可以获得哪些能力。
2. [接入架构与数据契约](agent/architecture.md)：模块位置、工具、权限、制度检索、作业和异步 AI 节点。
3. [实施与学习路线](agent/implementation-plan.md)：先读哪些代码、分几步实现、每步如何验收。
