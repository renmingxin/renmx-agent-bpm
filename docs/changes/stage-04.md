# 阶段 4 文件变更清单

相对 stage-3，本阶段的完整文件级变化如下。生成文件的职责只作定位，不需要逐行阅读。

| 变化 | 文件                                                    | 作用/改动                                                                 |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| 修改 | `README.md`                                             | 当前阶段的运行入口与课程索引                                              |
| 新增 | `apps/web/src/app/designer/[id]/page.tsx`               | 动态设计器路由，服务端路由壳加载客户端 Designer。                         |
| 修改 | `apps/web/src/app/globals.css`                          | 样式入口：按基础 → 页面 → 响应式的顺序加载，保证覆盖关系清晰。            |
| 修改 | `apps/web/src/app/processes/page.tsx`                   | 流程管理路由入口，列表与新建操作由 Processes 负责。                       |
| 新增 | `apps/web/src/components/designer/form-builder.tsx`     | 表单设计画布：选择字段、展示排列，并复用真实 FormFields 做预览。          |
| 新增 | `apps/web/src/components/designer/index.tsx`            | 设计器状态协调器：React Flow 的画布状态与可持久化 Definition 在这里转换。 |
| 新增 | `apps/web/src/components/designer/nodes.tsx`            | React Flow 自定义节点注册表。                                             |
| 新增 | `apps/web/src/components/designer/palette.tsx`          | 左侧组件库与流程元信息面板。                                              |
| 新增 | `apps/web/src/components/designer/properties-panel.tsx` | 右侧属性编辑器：根据选中对象显示节点、连线或表单字段的配置。              |
| 新增 | `apps/web/src/components/processes.tsx`                 | 设计态流程列表与运行态发起入口。                                          |
| 新增 | `apps/web/src/styles/designer.css`                      | 设计器三栏布局、画布节点、属性面板和表单设计画布。                        |
| 修改 | `docs/README.md`                                        | 截至本阶段的章节导航                                                      |
| 新增 | `docs/changes/stage-04.md`                              | 本阶段学习文档或检查清单                                                  |
| 新增 | `docs/stage-04-visual-designer.md`                      | 本阶段学习文档或检查清单                                                  |
