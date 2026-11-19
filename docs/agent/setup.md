# 智能审批助手：运行与配置

本页描述已经实现的五项能力：审批意见草稿、路线解释、自然语言填单、制度 RAG、异常字段检测。底层使用 **LangGraph + LangChain**，业务和制度保存在原 PostgreSQL 中。

## 1. 先启动工程

```powershell
pnpm install --frozen-lockfile
# 尚无 .env 时执行一次；已有配置时不要覆盖。
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm db:up
pnpm dev
```

打开 `http://127.0.0.1:3000`。侧栏“智能助手”是制度管理/问答入口；发起申请页有自然语言填单；申请详情页有意见草稿、路线解释、异常检测和制度问答。

模型尚未启动或没有配置密钥时，原有 BPM 仍能使用。路线解释与关闭语义模型后的异常检查也可以独立使用。

## 2. 对话模型：两种 provider 可以在页面切换

### 本地 Ollama

在 `.env` 中配置：

```dotenv
ASSISTANT_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:2b
```

`qwen3.5:2b` 是本机验收使用的示例名称，可以换成自己的模型。先确保 `ollama list` 能看到它；没有时自行拉取：

```powershell
ollama pull qwen3.5:2b
ollama list
```

页面提供模型列表和手动名称输入，选择保存在浏览器本机；不自动下载模型。Ollama 调用使用 schema 约束 JSON 解码并关闭思考输出；输出仍须经过服务端字段/引用校验。

### OpenAI 或兼容 Chat Completions 的服务

```dotenv
ASSISTANT_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=你的模型名称
OPENAI_API_KEY=你的服务端密钥
```

兼容服务改为自己的 `/v1` 地址与模型名。服务无鉴权时也需填写一个占位 key，例如 `local`，供客户端初始化使用。密钥只在服务端，页面不保存或展示密钥。

也可以通过 Ollama 的 OpenAI 兼容端点试用第二种适配器：

```dotenv
OPENAI_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_MODEL=qwen3.5:2b
OPENAI_API_KEY=ollama
```

修改 `.env` 后重启 `pnpm dev`。页面仍可切换两个 provider，并输入各自任意已部署模型名；`ASSISTANT_PROVIDER` 只是没有本地偏好时的默认值。

兼容端点不一定实现 `/models`。列表失败时可以手动输入。模型应能生成遵守指令的 JSON；很小的模型也可能漏字段、误解制度或把摘录格式写错。格式/依据校验失败会显示错误，不会因此批准或驳回业务。

## 3. RAG 检索：关键词或向量混合

对话模型和 Embedding 模型独立配置，切换聊天模型不会改变既有制度索引。

### 默认：中文关键词检索

```dotenv
ASSISTANT_EMBEDDING_PROVIDER=keyword
```

无需向量模型。制度经切分后存入 PostgreSQL；查询使用中文字符/二元词及英文词匹配，检索结果交给所选对话模型回答并引用。这也是检索增强生成，只是 retrieval 使用词项匹配。

### Ollama 向量混合检索

```dotenv
ASSISTANT_EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=mxbai-embed-large:latest
```

本机已用上述向量模型验收；也可换用已安装的 Embedding 模型，例如先自行拉取其他合适模型。对话模型不一定支持 Embedding，不能直接把聊天模型名填入这里。

### OpenAI / 兼容向量接口

```dotenv
ASSISTANT_EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

沿用 `OPENAI_BASE_URL` 与 `OPENAI_API_KEY`；兼容服务还需实际实现 `/embeddings`。更换向量服务或模型后，以新版本重新导入制度。旧索引与当前 profile 不一致时不做向量比较，仍可使用关键词召回。

向量以 JSONB 数组存储，检索时在 Node 中算余弦并结合关键词分数，没有额外安装 pgvector。这适合当前小规模教学库；较大知识库应迁移到数据库向量索引并做召回评测，不能把当前全量扫描视为生产方案。

## 4. 导入制度与问答

1. 切换陈亦舟或王知远，打开侧栏“智能助手”。林晓可问答，但不能导入/启停制度。
2. 填标题、整数版本、业务分类、生效期。
3. 上传 UTF-8 TXT、Markdown、文本 PDF 或 DOCX，或者直接粘贴正文。上传优先于粘贴；最大 4MB、正文 120000 字符、单文档 200 个片段。
4. 点击“导入并建立索引”。Embedding 失败时导入失败，不保存半成品。
5. 在旁边输入具体问题并生成回答，展开“制度依据”查看真实检索片段、版本和片段编号。

示例文档：[演示差旅制度](../examples/expense-policy.md)。它仅用于学习，不代表实际公司的报销政策。扫描 PDF 和图片需要先 OCR；本版没有 OCR、票据验真或附件合规证明能力。

检索先按流程分类与适用日期过滤，然后在同标题/分类中选择当前启用的最高版本。报销有 `date` 时以费用发生日匹配；无业务日期或独立问答时使用当前上海日期。停用可以恢复；若旧版本仍启用且适用，会回退检索旧版本。

## 5. 五项功能怎样体验

| 功能         | 入口与操作                                                                          | 结果                                                                     |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 自然语言填单 | 发起费用报销，描述“申请报销2026年11月18日的差旅交通费420元，用于客户项目现场交付。” | 候选字段及对应原文；确认后填入表单，再由人提交                           |
| 路线解释     | 新申请页或详情页选择路线解释                                                        | 真实历史和假设路径分开；金额 3000 与 3000.01 走不同分支                  |
| 审批意见草稿 | 当前审批人进入详情，选择方向并生成                                                  | 人核对后填入审批意见；只有点击原审批按钮才提交                           |
| 制度问答     | 制度库或申请上下文中提问                                                            | 基于适用片段回答并展示来源；无依据时明确说明                             |
| 异常字段检测 | 检查当前填写或修订中的表单                                                          | 规则问题与模型待核实项分开；负数金额、未来发生日等不会被当成自动驳回理由 |

异常检查的确定性部分包含必填、类型、选项、日历日期，以及已知 `amount`/`days` 的非正数、报销发生日晚于今天等提醒。自定义数字不会自动继承金额语义；模型补充跨字段矛盾线索，必须附对应字段原文。

表单、功能、问题或模型发生变化，旧分析显示过期。慢响应不会覆盖新上下文；生成过程中业务实例变化也会被服务端拦截。模型输出不是已经发生的审批事实。

目前没有自动证明“费用符合公司标准”的合规规则。模型若在意见中擅自作出这类肯定判断，会回退到表单事实与待核实意见并显示原因；明显不属于引擎路径的审批节点描述会被拦截。其他语义建议仍需人工复核，不能把这些检查视为通用事实正确性证明。

## 6. 调用与存储边界

新增接口：

| 方法与路径                            | 用途                             |
| ------------------------------------- | -------------------------------- |
| `GET /api/assistant/config`           | 公开模型配置摘要，隐藏 key       |
| `GET /api/assistant/models/:provider` | 模型列表；失败时可手动输入       |
| `POST /api/assistant/run`             | 五种功能；返回绑定输入指纹的结果 |
| `GET/POST /api/assistant/policies`    | 列表与导入                       |
| `PATCH /api/assistant/policies/:id`   | 启停制度                         |

PostgreSQL 新增 `assistant_policies` 与 `assistant_reports`，前者保存版本正文/片段/索引，后者保存成功建议及请求人和输入指纹。本版采用有界的同步 LangGraph 调用，没有后台可恢复作业或自由多轮工具循环；“取消等待”仅取消浏览器等待，不保证模型停止计算。

每个用户最多 2 个并发分析，单 API 进程最多 6 个；图总预算约 65 秒。限制是进程内的，正式多实例部署需要共享限流与持久化作业。报告目前没有自动清理，部署真实业务前需确定数据保留策略。

仍使用原来的可切换演示身份，不是生产登录。助手会额外检查申请参与人/当前待办处理人，并在制度管理上检查演示角色；接真实业务前仍需要可信会话、完整数据权限、租户隔离和数据出境/保留配置。

## 7. 接着读代码

先看 [stage-6 学习文档](../stage-06-approval-assistant.md)。其中按调用链给出阅读顺序、关键取舍、练习与验证方式。

实现参考了 [LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)、[ChatOllama](https://docs.langchain.com/oss/javascript/integrations/chat/ollama) 与 [ChatOpenAI](https://docs.langchain.com/oss/javascript/integrations/chat/openai) 官方文档；具体配置以本工程锁定的依赖与类型检查为准。
