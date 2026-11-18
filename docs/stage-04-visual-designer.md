# 阶段 4 · 将可视化画布转换成业务定义

> 代码快照：`stage-4`。上一阶段：`stage-3`。

## 一、本阶段目标

能添加、连接、配置和删除节点，配置表单，保存草稿并发布新版本，知道画布状态与执行定义之间的边界。

## 二、新引入的概念

**受控画布**：React Flow 负责拖拽、缩放、选择与连线体验，父组件保存 nodes/edges。点击属性面板修改节点数据后，画布随 React 状态更新。

**稳定的节点注册表**：`nodeTypes` 放在组件外，避免每次渲染都生成新的组件映射。`ReactFlowProvider` 包住使用 useReactFlow 的编辑器，保证坐标转换和视图操作有上下文。

**设计数据与 UI 临时数据分离**：measured、selected 等是画布内部状态；Definition 只需要节点 ID、类型、位置、配置和连线。保存前显式映射，避免把整个 React Flow 对象塞进数据库。

## 三、按这个顺序阅读代码

1. `app/designer/[id]/page.tsx` → `components/designer/index.tsx` 的 Designer：加载数据并建立 Provider。
2. Editor 的状态定义和 definition 映射：哪些状态会持久化，哪些只服务交互。
3. `nodes.tsx`：看四类节点的 target/source 端口，重点是条件节点 yes/no。
4. `palette.tsx` → addNode → screenToFlowPosition：把屏幕坐标变成画布坐标，解释缩放后为什么不能直接用 clientX。
5. connect → addEdge：连线一旦创建，运行引擎如何识别分支。
6. `properties-panel.tsx`：通过 updater 改父组件，避免子面板维护独立数据副本。
7. `form-builder.tsx` 与 addField：字段标识为什么既服务表单又服务条件节点。
8. save：schema 校验 → 图校验 → PATCH 保存 → 使用新 revision 发布。
9. layout：拓扑分层只改 position；有回路时不会无限排队，发布校验仍会拒绝回路。
10. `components/processes.tsx`：新建、模板复制、启停和运行态入口如何连接设计器。

**重点**：保存草稿允许图暂时不完整，发布必须能运行。`label` 是给人看的，ID 与 handle 才是执行协议。

## 四、如何验证与练习

```powershell
pnpm dev
```

1. 流程管理新建“空白流程”，修改流程名称与审批人。
2. 表单设计添加一个必填数字字段，标识改成 `budget`。
3. 返回画布添加条件节点，配置 `budget > 3000`。
4. 删除原有部门审批到终点的连线，改接条件节点，再为 yes/no 各接一条路径。
5. 保存后刷新，预期位置和表单配置都保留。
6. 发布，发起申请，在运行历史验证路径。

练习：删除一条分支后发布，解释错误并修复；复制流程后修改副本，确认原流程不受影响。

## 五、常见问题

- **打开设计器就显示未保存**：对象键顺序可能被 JSONB 调整；内容比较使用 definitionSignature，不能依赖对象键顺序。
- **画布空白**：React Flow 的父容器必须有确定高度；本工程由 editor-body 和 flow-canvas 的 flex/grid 尺寸传递。
- **切换表单页后节点坐标异常**：不要把屏幕坐标直接写入 position，使用 screenToFlowPosition。
- **两个窗口保存冲突**：409 表示 revision 已变化，刷新后查看另一页面的修改再编辑，不应无条件覆盖。

## 六、本阶段文件变更清单

新增设计器路由和五个职责分离的设计组件、设计器样式；升级流程列表为完整设计/运行双视图。完整清单见 `changes/stage-04.md`。
