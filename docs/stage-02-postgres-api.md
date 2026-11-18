# 阶段 2 · 把一次审批作为事务保存

> 代码快照：`stage-2`。上一阶段：`stage-1`。

## 一、本阶段目标

只使用 HTTP 就能创建、发布、发起和审批流程；理解数据如何在 PostgreSQL 中保持一致。

## 二、新引入的概念

**分层**：Controller 处理 HTTP，Service 编排业务，Repository 读写数据，core 计算下一步。按照这条调用链阅读，不要一开始钻进所有装饰器。

**事务与行锁**：一次审批会同时改变旧任务、实例、历史和下个任务。任何一步失败都应回滚。`FOR UPDATE` 让同一待办的两个请求排队，第二个拿到锁后看见已完成状态并返回 409。

**不可变快照**：发布时复制 draft，发起时再复制已发布版本进 Instance。之后编辑模板、发布新版本或停用流程，都不会改变旧实例的执行定义。

## 三、按这个顺序阅读代码

1. `apps/api/src/main.ts` → `app.module.ts`：找出依赖注册与启动顺序。
2. `bpm.controller.ts` 的 `start`：请求数据先经过 `startSchema.parse`，再调用 service。
3. `bpm.service.ts` 的 `start`：已发布版本 → 表单校验 → 实例 → move → 持久化。
4. `move` → core 的 `advance`：明确纯计算与创建 Task 的边界。
5. `act`：按“锁任务、检查人、锁实例、校验表单、完成任务、推进流程”的顺序做笔记。
6. `store.ts` 的 `transaction`：特别注意 callback 收到的 tx 与外层 store 不是同一连接对象。
7. `database/schema.ts`：观察 JSONB、生成列、外键和部分唯一索引。
8. `save`、`publish`、`setEnabled`：revision 是设计态乐观锁，与审批时的数据库行锁配合解决不同问题。
9. `error.filter.ts` 与 `seed.ts`：业务错误如何转成 HTTP；演示数据为何通过正式入口创建。

**重点**：不要在事务回调里调用 `store.put`，要调用 `tx.put`。连接池中的下一次查询可能落到另一条连接，导致假事务。申请编号使用 sequence，不能用当前记录数量加一。

## 四、如何验证与练习

```powershell
pnpm db:up
pnpm dev
```

另开终端：

```powershell
$headers = @{ 'x-user-id' = 'u-chen' }
$data = Invoke-RestMethod http://127.0.0.1:3000/api/dashboard -Headers $headers
$data.workflows | Select-Object id, enabled, revision
docker compose exec postgres psql -U bpm -d bpm -c '\dt'
```

预期首次空库出现三个流程，数据库出现 workflows、instances、tasks。每次重启保留原数据。

练习：发起费用申请后修改并发布模板的审批人，观察旧实例仍然保留旧人。用 API 把同一 task 同意两次，第二次应返回 409。

## 五、常见问题

- **为什么先插入 Instance 再 move**：Task 表外键要求实例先存在，但其他连接直到提交后才看得到这次事务。
- **初始化 SQL 没再次执行**：Docker 的 init 目录只在空卷首次启动时执行；应用建表由 Store.initialize 负责，两者边界不同。
- **SQL 比想象中少**：流程图和字段结构会变化，因此用 JSONB 保存快照，关联与关键不变量仍由生成列、外键和索引约束。本版没有引入 ORM。
- **身份头安全吗**：这是本地演示协议，正式系统要从受验证登录会话推导用户 ID，而不是信任浏览器提交的任意身份。

## 六、本阶段文件变更清单

新增 API 控制器、模块、业务服务、仓储、迁移、异常过滤器和种子数据；替换最小 main 启动代码以连接 PostgreSQL。完整逐文件清单见 `changes/stage-02.md`。
