# 00 · 先弄懂一次请求怎样旅行

[学习总入口](README.md) · 下一篇建议读 [路线解释](02-route-explanation.md)

## 一、本篇目标

不用先掌握 LangGraph 的所有 API。读完能回答三个问题：前端与后端分别在哪；为什么模型回答不能直接当审批结果；一次“生成”经过哪五个图节点。

先体验一个动作：打开工作台，进入费用报销发起页，在助手里输入一句费用描述并生成。此时先别提交申请，观察候选值、原文依据、待确认事项和“查看本次处理步骤”。

## 二、把陌生词翻译成人话

| 名词       | 本项目里可以怎样理解                   | 代码里的例子                                       |
| ---------- | -------------------------------------- | -------------------------------------------------- |
| 前端       | 浏览器里的页面和交互                   | `apps/web`，Next.js + React                        |
| 后端       | 接收请求、检查权限、读取数据、调用模型 | `apps/api`，NestJS                                 |
| 共享包     | 前后端共同使用的规则和数据格式         | `packages/bpm-core`                                |
| API / HTTP | 页面与后端约定的通信入口               | `POST /api/assistant/run`                          |
| JSON       | 传输数据的文本格式                     | `{"feature":"route"}`                              |
| schema     | 数据的格式和约束说明                   | `assistantInputSchema` 检查 feature 是否有效       |
| Controller | 接口接待处：接参数、校验、转交         | `AssistantController.run()`                        |
| Service    | 负责完成业务工作的类                   | `AssistantService`、`PolicyService`                |
| LLM        | 根据输入生成文字/结构化数据的语言模型  | Ollama 中的 `qwen3.5:2b`                           |
| provider   | 模型服务的接入类型                     | `ollama` 或 `openai`                               |
| prompt     | 给模型的任务说明                       | `fillPrompt` 说明怎样提取字段                      |
| LangChain  | 把不同模型服务封装成相近的调用方式     | `ChatOllama`、`ChatOpenAI`                         |
| LangGraph  | 明确安排多个处理步骤的执行顺序         | `prepare → rules → retrieve → generate → validate` |
| state      | 图执行时各步骤传递的数据包             | `input`、`context`、`sources`、`result`            |
| RAG        | 先找文档片段，再让模型参考片段回答     | 先检索差旅制度，再解释材料要求                     |
| Embedding  | 将文字转换成用于相似性比较的数字数组   | 文档向量、问题向量                                 |
| 候选值     | 可以由人采纳，还没有正式提交的数据     | `result.fields.amount`                             |

读 TypeScript 时，`interface`/`type` 帮编辑器检查类型；数据从 HTTP 进入程序后，仍要靠 `schema.parse()` 执行实际校验。`async` 函数会返回 Promise；`await` 表示等待结果；`try/catch/finally` 用来处理成功、异常和必须清理的资源。碰到这些词时先理解作用，不需要同时学习全部语法。

本项目的 Agent 是一个有界的助手编排：步骤写在代码里，一次分析最多走一次生成分支，没有自由选择工具、反复思考执行的循环。模型不持有“同意审批”工具。

设计器里的 BPM 图表示申请业务怎么流转，LangGraph 图表示一次助手分析怎么处理。两者都叫“图”，但数据结构、运行时机和职责不同：人工待办可以等待很久，助手这条图在一次请求内完成并返回建议。

## 三、先按六个位置读公共链路

### 1. 页面收集输入

打开 [assistant-panel.tsx](../../../apps/web/src/components/assistant/assistant-panel.tsx)，搜索 `generate`。

页面持有 `feature`、用户文字 `text`、候选表单 `data`、模型选择 `choice`。点击生成后，把它们打包为 JSON。`instanceId` 表示已有申请，`workflowId` 表示还没发起的流程模板。

搜索 `needsModel`：路线解释和关闭语义检测的异常检查不需要对话模型，因此不会把模型选择作为必填。

### 2. 请求经过 Next.js 到 NestJS

[shell.tsx](../../../apps/web/src/components/shell.tsx) 的请求封装补上 `/api` 前缀和 `x-user-id`。浏览器请求发送到 `http://127.0.0.1:3000/api/...`，再由 [next.config.ts](../../../apps/web/next.config.ts) 中的代理转到本地 NestJS。

`x-user-id` 是可切换的演示身份，例如林晓 `u-lin`、陈亦舟 `u-chen`、王知远 `u-wang`，当前并非正式登录系统。

### 3. 接口先检查结构，再交给服务

打开 [assistant.controller.ts](../../../apps/api/src/assistant/assistant.controller.ts)，搜索 `@Post('run')`。

```ts
return this.assistant.run(assistantInputSchema.parse(body), actor(user));
```

从右往左理解：`actor` 识别演示用户；`parse` 检查 JSON 字段格式；真正的处理交给 Service。检查“字段是字符串”与检查“这个人能否看这份申请”是两种不同工作，后者还在 `context()` 中进行。

### 4. Service 启动图，state 在节点间传递

打开 [assistant.service.ts](../../../apps/api/src/assistant/assistant.service.ts)，按 `State` → `.addNode` → `.addEdge` → `run()` 的顺序看。

`Annotation.Root` 声明 state 中有哪些通道；每个节点返回本次更新的字段，图将它们传给下一步。它不是 React 的 `useState`，而是服务端本次调用的数据。

| 节点     | 用人话描述                          | 主要产物                                      |
| -------- | ----------------------------------- | --------------------------------------------- |
| prepare  | 找到真实流程/申请，检查是否有权分析 | `context`，含定义、表单、待办、指纹、上海日期 |
| rules    | 让代码先执行能确定的检查            | `result.findings` 与可模拟时的 `result.route` |
| retrieve | 按功能决定是否查制度                | `sources`，检索片段重新编号为 S1、S2 等       |
| generate | 调模型生成，或直接构造确定性文字    | `generated`，此时仍是不可信输出               |
| validate | 查结构、字段/来源、版本，再保存报告 | 最终 `AssistantResult`                        |

所有能力走同一组节点。例如 route 在 retrieve 内直接返回空来源，在 generate 内直接构造说明，并没有调用模型。`rules` 也会为填单尝试检查当时的空表单；它不等于已经核验了随后生成的候选值。

### 5. 模型与应用共同组成最终结果

模型调用在 [model-gateway.ts](../../../apps/api/src/assistant/model-gateway.ts) 的 `generate()`：provider 分支 → 发送系统说明和业务数据 → 读取响应 → 解析 JSON。

Ollama 通过 [output-schema.ts](../../../apps/api/src/assistant/output-schema.ts) 的 `decodingSchema()` 限制生成格式；OpenAI 兼容路径没有假定支持同样的原生约束。两者都需要 Service 再做后验校验。

模型只提供内容。报告 ID、输入指纹、真实路线、规则结果、保存动作由应用程序负责。看最终协议 [assistant.ts](../../../packages/bpm-core/src/assistant.ts)，先认下面八个字段：

| 字段                       | 你在页面看到什么                 |
| -------------------------- | -------------------------------- |
| `text`                     | 主体回答或意见草稿               |
| `fields` / `fieldEvidence` | 字段候选值及其用户原文           |
| `questions`                | 缺少或需要核实的信息             |
| `findings`                 | 规则问题与模型待核实提示         |
| `route`                    | 实际记录与假设路线               |
| `sources`                  | 最终实际引用、校验通过的制度片段 |
| `warnings`                 | 限制、修复或降级说明             |
| `inputHash` / `steps`      | 绑定的输入指纹与部分处理步骤     |

### 6. 返回页面并等待人操作

`AssistantPanel` 把结果存入 React 的 `result` 状态，按 `feature` 展示对应区域。“确认候选值并填入表单”和“填入审批意见，继续核对”调用父页面回调，只更新页面中的编辑值。

真正发起申请走 `POST /api/workflows/:id/instances`，真正审批走 `POST /api/tasks/:id/actions`。分析会保存一条 `assistant_reports` 报告，但不因此创建业务实例或完成待办。

### 为什么会显示过期

前端 `contextKey` 用于发现文字、表单、身份或模型等输入变化，过期后禁用采纳；服务端 `fingerprint` 用于复核生成前后的业务快照。两者各管一层。取消浏览器等待也不保证 Ollama 已停止计算。

## 四、第一次实验：先准备好环境与观察工具

### 1. 启动工程

在项目终端执行。已有 `.env` 请保留，首次配置按 [运行指南](../setup.md) 完成。

```powershell
Set-Location 'H:\code\next-bpm'
pnpm install --frozen-lockfile
pnpm db:up
pnpm dev
```

这个终端会持续运行服务。另开一个 PowerShell 终端检查：

```powershell
Invoke-RestMethod 'http://127.0.0.1:4000/api/health'
ollama list
```

预期健康接口返回 `ok: true`、`storage: postgresql`。调用模型的课程需要 Ollama 运行，且列表含你选择的模型；纯路线/规则实验不需要对话模型。

### 2. 在浏览器看一次真实请求

打开 `http://127.0.0.1:3000`，按 F12，选 Network，清空记录，点击一次助手“生成”。找到 `assistant/run`：

1. 看 Headers：方法为 POST，有当前演示身份。
2. 看 Payload：找 `feature`、目标 ID、`data`、`text`、`model`。
3. 看 Response：先找 `text`，再找当前功能专属字段。
4. 回页面展开“查看本次处理步骤”，与响应的 `steps` 比较。

这四步比先读完几百行服务代码更容易建立直觉。

### 3. 为后续接口实验准备公共函数

下面代码在**另一个 PowerShell 终端一次性执行**，后面五篇的接口示例共用同一个终端。`$lessonWorkflowId` 从当前数据库读取，不需要手抄固定 ID。函数只发送助手分析请求；成功分析会保存建议报告。

```powershell
$lessonApi = 'http://127.0.0.1:4000/api'
$lessonDashboard = Invoke-RestMethod "$lessonApi/dashboard" -Headers @{'x-user-id'='u-lin'}
$lessonExpense = $lessonDashboard.workflows | Where-Object {
  $_.enabled -and $_.versions.Count -gt 0 -and $_.versions[-1].definition.category -eq 'expense'
} | Select-Object -First 1
if (-not $lessonExpense) { throw '请先在页面发布并启用一个费用报销流程，再执行本段。' }
$lessonWorkflowId = $lessonExpense.id

function Invoke-AssistantLesson {
  param([hashtable]$Payload, [string]$UserId = 'u-lin')
  $lessonBody = $Payload | ConvertTo-Json -Depth 20
  Invoke-RestMethod "$lessonApi/assistant/run" `
    -Method Post `
    -Headers @{'x-user-id'=$UserId} `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($lessonBody)) `
    -TimeoutSec 75
}
```

反引号是 PowerShell 的续行符，后面不要加空格。中文请求转成 UTF-8 字节发送，避免旧终端的默认编码干扰文字。更喜欢点页面时，可以跳过全部接口示例。

### 4. 自测与答案

先合上文章口头回答，再对照：

| 问题                               | 应能说出的答案                                           |
| ---------------------------------- | -------------------------------------------------------- |
| 模型在哪里调用？                   | `ModelGateway.generate()`，不是 Controller 或 React 页面 |
| `generated` 是最终结果吗？         | 不是，还需结构、业务、依据和版本校验                     |
| 生成草稿保存到了哪里？             | 成功建议存 `assistant_reports`，不是审批历史             |
| 改金额后旧建议为什么不能直接采纳？ | 它绑定的是旧输入，路线或语义结论可能已变化               |

## 五、遇到问题先查哪里

| 现象                   | 先检查                                                  |
| ---------------------- | ------------------------------------------------------- |
| 页面能开，接口报不可用 | `4000/api/health`、API 终端、Docker 数据库              |
| 401/403                | 演示身份是否有效、是否为申请参与人、是否当前待办审批人  |
| 409 要求重新生成       | 请求期间申请、发布版本或被引用制度发生变化              |
| 模型 JSON/连接失败     | Ollama 地址、模型名、模型服务；区别于“缺少字段”         |
| 显示过期               | 表单、问题、功能、身份或模型是否改变；重新生成          |
| 纯路线也要求数据库     | HTTP 入口要读取上下文并保存报告，纯函数才没有数据库依赖 |

暂时不明白 `Annotation` 或 NestJS 注入时，先把它理解为“定义数据包”和“拿到依赖的服务对象”。先读 [路线解释](02-route-explanation.md)，用最少变量走通一次。
