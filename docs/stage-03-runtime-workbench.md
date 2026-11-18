# 阶段 3 · 从表单提交追踪到工作台

> 代码快照：`stage-3`。上一阶段：`stage-2`。

## 一、本阶段目标

在浏览器里以申请人提交表单，再切换审批人完成任务，能够跟踪前后端整条数据链。

## 二、新引入的概念

**客户端边界**：Next 的 page/layout 可以保留为简单的服务端入口，交互状态放进带 `use client` 的组件。路由文件只负责组装，不承载所有业务。

**派生状态**：工作台的待办数由 Task 推导，申请列表由 Instance 筛选。不要同时存一份“计数”再手工同步，否则一次流转就可能出现两个不同数字。

**Schema 驱动表单**：设计数据说明字段类型、必填与选项，同一个 FormFields 在发起、核对和只读展示中复用。

## 三、按这个顺序阅读代码

1. `apps/web/src/app/page.tsx` → `components/workbench.tsx`：路由如何接入工作台。
2. `components/shell.tsx` 的 AppProvider → `lib/client.tsx`：身份如何进入请求头，request 为何随身份变化。
3. `useRemote`：每次 path/user/reload 变化取消旧请求；关注 AbortController 和 effect 清理函数。
4. `workbench.tsx`：先看 pending/handled/started，再看 rows；最后才看展示 JSX。
5. `runtime/start-process.tsx`：读取发布版本和收集表单。
6. `form-fields.tsx` 的 collectFields：浏览器原始值如何打包为 JSON。
7. 回到 service.start，再返回 `runtime/instance-detail.tsx`：完整走一遍提交链路。
8. 详情页 submit：同意和驳回共用表单；`formNoValidate` 让驳回不被申请字段的必填约束阻挡，但驳回原因仍必填。
9. 对照 `styles/runtime.css` 与 `styles/workbench.css`，只读当前页面相关样式。

**重点**：只读快照来自 Instance，不来自 Workflow 的当前草稿。前端 canAct 决定显示操作，服务端 act 再次检查处理人，二者缺一不可。

## 四、如何验证与练习

```powershell
pnpm db:up
pnpm dev
```

打开 `http://127.0.0.1:3000`：

1. 右上角选林晓，发起 4200 元费用报销。
2. 切换陈亦舟，找到待办，填写意见并同意。
3. 流程自动走金额满足分支，待办交给王知远。
4. 切换王知远同意，预期状态为已完成，历史记录含自动判断。
5. 再发起 1000 元申请；部门负责人同意后直接完成。

练习：审批时把 4200 改为 1000，确认后续路由使用修改后的数字，历史中出现修改内容。再练习缺少意见的驳回，确认页面会提示补充原因。

## 五、常见问题

- **身份一切换数据变了**：request 依赖当前 user，useRemote 会重取数据；这正是预期行为。
- **点击同意后为什么再读取**：流程状态由后端引擎和事务决定，不能用前端猜测更新。
- **写入成功但刷新失败**：页面将操作成功和重新读取区分处理，避免把网络读取错误误认为审批未提交。
- **为什么日期固定上海时区**：服务端存 ISO 时间，页面用明确时区展示，避免同一事件在不同时区跨天。

## 六、本阶段文件变更清单

新增完整布局、Context/请求工具、工作台、动态表单、申请发起与详情页、基础 UI 组件及分区 CSS；此时流程列表只提供启动入口。完整清单见 `changes/stage-03.md`。
