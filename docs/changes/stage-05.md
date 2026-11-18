# 阶段 5 文件变更清单

相对 stage-4，本阶段的完整文件级变化如下。生成文件的职责只作定位，不需要逐行阅读。

| 变化 | 文件                                   | 作用/改动                                                         |
| ---- | -------------------------------------- | ----------------------------------------------------------------- |
| 修改 | `README.md`                            | 当前阶段的运行入口与课程索引                                      |
| 新增 | `apps/api/test/bpm.test.ts`            | PostgreSQL 集成测试：直接使用 Docker 中的 bpm_test 数据库。       |
| 修改 | `docs/README.md`                       | 截至本阶段的章节导航                                              |
| 新增 | `docs/architecture.md`                 | 本阶段学习文档或检查清单                                          |
| 新增 | `docs/changes/stage-05.md`             | 本阶段学习文档或检查清单                                          |
| 新增 | `docs/stage-05-tests-and-extension.md` | 本阶段学习文档或检查清单                                          |
| 新增 | `overview.md`                          | 交付边界与端到端验证记录                                          |
| 修改 | `package.json`                         | 根命令、运行环境与开发工具                                        |
| 新增 | `scripts/check-comments.mjs`           | 阅读性检查：确保每个手写源码/样式/脚本/SQL 文件都有文件职责注释。 |
