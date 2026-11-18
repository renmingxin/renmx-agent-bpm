# 阶段 3 文件变更清单

相对 stage-2，本阶段的完整文件级变化如下。生成文件的职责只作定位，不需要逐行阅读。

| 变化 | 文件                                                  | 作用/改动                                                                               |
| ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 修改 | `README.md`                                           | 当前阶段的运行入口与课程索引                                                            |
| 修改 | `apps/web/src/app/globals.css`                        | 样式入口：按基础 → 页面 → 响应式的顺序加载，保证覆盖关系清晰。                          |
| 新增 | `apps/web/src/app/instances/[id]/page.tsx`            | 动态实例详情路由，[id] 是实例 ID，与流程 ID、待办 ID 不同。                             |
| 修改 | `apps/web/src/app/layout.tsx`                         | App Router 根布局：设置页面元信息与中文语言，装配全局 Provider 和应用外壳。             |
| 修改 | `apps/web/src/app/page.tsx`                           | 工作台路由入口：路由只组装页面，具体逻辑在 Workbench。                                  |
| 新增 | `apps/web/src/app/processes/page.tsx`                 | 阶段 3：只提供已发布模板的发起入口，设计管理将在下一章加入。                            |
| 新增 | `apps/web/src/app/start/[id]/page.tsx`                | 动态发起页路由，[id] 是流程 ID，由 StartProcess 读取参数并加载发布版本。                |
| 新增 | `apps/web/src/components/form-fields.tsx`             | 动态表单渲染器：把 FormField schema 映射为原生 HTML 控件。                              |
| 新增 | `apps/web/src/components/runtime/index.ts`            | 运行态页面公共入口，路由层不需要知道内部组件的组织方式。                                |
| 新增 | `apps/web/src/components/runtime/instance-detail.tsx` | 运行态详情：展示实例快照、当前待办和历史，并允许指定审批人同意或驳回。                  |
| 新增 | `apps/web/src/components/runtime/route-preview.tsx`   | 流程结构摘要：解释节点及审批人，供发起页与详情页复用。                                  |
| 新增 | `apps/web/src/components/runtime/start-process.tsx`   | 发起申请页面：读取最新发布版本 → 填写动态表单 → POST 创建实例 → 打开详情。              |
| 新增 | `apps/web/src/components/shell.tsx`                   | 全局外壳与应用状态：侧栏导航、身份选择、指南弹窗和操作反馈。                            |
| 新增 | `apps/web/src/components/ui.tsx`                      | 跨页面的轻量展示组件。                                                                  |
| 新增 | `apps/web/src/components/workbench.tsx`               | 运行态工作台：从实例与任务推导当前用户的待办、已办和发起记录。                          |
| 新增 | `apps/web/src/lib/client.tsx`                         | 浏览器请求与状态工具：当前用户 Context、统一 JSON API、可取消的数据读取和北京时间显示。 |
| 新增 | `apps/web/src/styles/base.css`                        | 全局设计变量、基础排版和通用按钮/状态标签。                                             |
| 新增 | `apps/web/src/styles/forms.css`                       | 原生弹窗、表单控件、反馈与空状态。                                                      |
| 新增 | `apps/web/src/styles/processes.css`                   | 流程列表、筛选器和流程卡片。                                                            |
| 新增 | `apps/web/src/styles/responsive.css`                  | 响应式覆盖、触摸目标与减少动画偏好；置于最后覆盖基础样式。                              |
| 新增 | `apps/web/src/styles/runtime.css`                     | 发起申请、审批详情和流转时间线。                                                        |
| 新增 | `apps/web/src/styles/shell.css`                       | 应用外壳：侧栏、顶部导航、内容区和页脚。                                                |
| 新增 | `apps/web/src/styles/workbench.css`                   | 工作台：欢迎区、统计卡、任务表和快速发起。                                              |
| 修改 | `docs/README.md`                                      | 截至本阶段的章节导航                                                                    |
| 新增 | `docs/changes/stage-03.md`                            | 本阶段学习文档或检查清单                                                                |
| 新增 | `docs/stage-03-runtime-workbench.md`                  | 本阶段学习文档或检查清单                                                                |
