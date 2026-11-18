# 阶段 1 · 先理解业务模型，再理解引擎

> 代码快照：`stage-1`。上一阶段：`stage-0`。

## 一、本阶段目标

不启动浏览器，也能用纯函数解释“一份 4200 元报销为什么会流转到财务”。

## 二、新引入的概念

**定义、版本、实例、任务** 是四件事。`Definition` 是流程图与表单；`Workflow` 管理草稿和发布版本；`Instance` 是某个人实际发起的一次申请；`Task` 是某一步指定给某个人的待办。一个流程能产生很多实例，一个实例按顺序产生多个任务。

**有向图** 用节点表达步骤，用连线表达顺序。节点的 `position` 只影响显示，`edges` 决定运行。条件的 `sourceHandle` 是 `yes` 或 `no`，连线 `label` 只是展示文字。

**纯引擎** 只算“下一步是什么”，不读数据库、不发请求、不调用 React。把副作用移到应用服务，就能用很小的输入验证业务算法。

## 三、按这个顺序阅读代码

1. `packages/bpm-core/src/types.ts`：先只看四个主要模型，再看节点和字段。最后看 Zod schema，理解运行时为什么还需要校验。
2. `templates.ts`：对照费用模板手画 `start → manager → condition → finance/end`，给每条边标注 source/target。
3. `engine.ts` 的 `advance`：输入 `from='manager'` 和 `amount=4200`，逐行记录 current、out、matched、next。
4. `validation.ts` 的 `validateDefinition`：先看每类节点的入/出线规则，再看 DFS 的 visited 和 stack。前者发现不可达节点，后者识别回路。
5. `validateForm`：观察字符串金额如何变为数字，未声明字段如何被过滤。
6. `test/engine.test.ts`：先读断言，再回实现寻找依据。

**重点**：审批节点意味着引擎暂停等待人，不是把整条流程同步执行到底。`advance` 的步数上限是防御，不能代替发布前图校验。

## 四、如何验证与练习

```powershell
pnpm --filter @bpm/core build
pnpm --filter @bpm/core test
```

预期全部核心测试通过，且不要求数据库或浏览器。

练习一：把金额条件改为 `gte`，解释 3000 元为什么改变路径。练习二：添加一个孤立节点，调用发布校验，观察错误。练习三：只改连线 label，证明执行路径不会变化。

验收：不用看代码，能解释 Workflow ID、Instance ID 与 Task ID 为什么不能混用。

## 五、常见问题

- **为什么开始和人工节点只有一条出线**：这是简易串行引擎的边界，避免同时产生多条人工任务；并行网关需要另一个执行模型。
- **为什么条件只允许必填数字字段**：缺失值和非数字值会使分支不可预测，本版在发布时就约束这种设计。
- **为什么比较定义不能直接 JSON.stringify**：PostgreSQL JSONB 会重排对象键，`definitionSignature` 排序对象键后比较内容，避免刚打开设计器就被误判为修改。

## 六、本阶段文件变更清单

新增 core 的 `types.ts`、`templates.ts`、`validation.ts`、`engine.ts` 和引擎单元测试；修改公共 `index.ts` 导出业务能力；首页显示当前阶段。完整清单见 `changes/stage-01.md`。
