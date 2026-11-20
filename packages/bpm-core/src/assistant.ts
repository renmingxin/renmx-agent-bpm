/**
 * 智能审批助手的公共数据协议，供 Next.js 页面与 NestJS 服务端共同引用。
 *
 * 可以按下面的顺序阅读：
 * 1. ModelChoice：本次调用使用哪一种模型服务、哪一个模型。
 * 2. AssistantInput：用户想执行什么功能，以及提供了哪些上下文。
 * 3. Finding / PolicySource / RouteStep：结果中的异常、制度依据与路线步骤。
 * 4. AssistantResult：将五项功能包装成同一种响应格式。
 * 5. AssistantConfig / PolicyInput / PolicyDocument：公开配置与制度管理协议。
 *
 * 两类定义的职责不同：
 * - z.object 等 schema 会在运行时校验、整理实际收到的数据。
 * - interface / type 主要供 TypeScript 编译期检查，不会自动验证 HTTP 数据。
 *
 * 本文件只描述可序列化数据，不导入 LangChain/LangGraph，也不发起模型请求。
 * 因此前端引用这些协议时，不会把服务端模型 SDK 或密钥一起带入浏览器。
 * 助手响应只是建议或候选值，真正的提交、审批和状态流转仍由原 BPM API 执行。
 */
import { z } from 'zod';

// 复用普通申请的“字段 key → 字符串/有限数字”协议，避免助手与 BPM 使用两套表单格式。
import { inputDataSchema } from './types';

/**
 * 单次对话模型选择的运行时校验规则。
 * 这里只允许选择服务类型与模型名；baseUrl、API Key 统一由服务端环境配置。
 */
export const modelChoiceSchema = z.object({
  /** ollama：本地 Ollama；openai：OpenAI 或兼容 Chat Completions 的服务。 */
  provider: z.enum(['ollama', 'openai']),

  /**
   * 实际部署的模型名称，例如 qwen3.5:2b。
   * trim 去掉首尾空白；名称不能为空，最长 150 个字符。
   * 这里不强制名称来自模型列表，兼容没有 /models 接口但能正常调用的服务。
   */
  model: z.string().trim().min(1).max(150),
});

/** 从 schema 推导出校验后的类型，新增 provider 等规则时不用再手写一份联合类型。 */
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

/**
 * POST /api/assistant/run 的统一输入协议。
 *
 * 这里检查结构、基础取值与长度；“谁能读取申请”“某功能需要什么上下文”
 * 等业务约束，由 AssistantService.context() 在读取真实业务数据后检查。
 * instanceId/workflowId 通常按场景选择其一；同时传入时，当前服务优先使用 instanceId。
 */
export const assistantInputSchema = z.object({
  /**
   * 功能标识，决定 LangGraph 节点中采用哪条处理分支：
   * - draft：起草当前审批环节的意见。
   * - route：解释实际历史与基于当前表单模拟的后续路线，无需对话模型。
   * - fill：将自然语言提取成待确认的表单候选值。
   * - policy：检索适用制度后回答问题，也允许不绑定具体申请的独立问答。
   * - anomalies：执行字段规则检查，并可附加模型语义检测。
   */
  feature: z.enum(['draft', 'route', 'fill', 'policy', 'anomalies']),

  /** 已发起的申请实例 ID，用于详情页；服务端据此加载实例自己的流程快照并检查参与人。 */
  instanceId: z.string().max(80).optional(),

  /** 流程模板 ID，用于尚未提交的申请；服务端使用最新已发布且启用的版本。 */
  workflowId: z.string().max(80).optional(),

  /**
   * 当前候选表单：key 使用字段的业务标识，例如 amount，而不是中文 label 或字段 id。
   * 值只能是字符串或有限数字；具体必填、选项、日期等规则需要结合流程定义再检查。
   * 对已有申请，不传则使用已保存数据；传入表示分析整份候选数据，不是局部更新补丁。
   * 分析候选值不会直接保存表单，且已有申请的候选数据只能由当前审批人提交分析。
   */
  data: inputDataSchema.optional(),

  /**
   * 随功能变化的用户文字：填单描述、制度问题或起草意见时的补充说明。
   * 先去除首尾空白，最多 4000 字符；省略时规范化为空字符串。
   * fill / policy 必须有内容，这项场景校验在服务层完成。
   */
  text: z.string().trim().max(4000).default(''),

  /** 只影响 draft 的意见方向，默认起草同意意见；它不是实际执行 approve/reject 的指令。 */
  intent: z.enum(['approve', 'reject']).default('approve'),

  /** 本次模型选择；未传时使用服务端默认模型。确定性分支可以不提供此项。 */
  model: modelChoiceSchema.optional(),

  /**
   * 仅对 anomalies 生效：true 为“规则检查 + 模型语义检测”，false 只执行代码规则。
   * 关闭模型时仍检查缺项、非法选项等问题，结果要明确说明语义部分没有执行。
   */
  semantic: z.boolean().default(true),
});

/**
 * schema.parse() 之后的输入类型。
 * 因为 text、intent、semantic 有 default，客户端可以省略，但校验后这些字段都会存在。
 * z.infer 表示校验后的输出类型；若需要描述校验前的原始输入，可使用 z.input。
 */
export type AssistantInput = z.infer<typeof assistantInputSchema>;

/** 一条字段检查发现。用于解释“哪里需要修正或核实”，本身不会自动驳回或阻止业务流转。 */
export interface Finding {
  /** 当前报告内的条目标识，供前端列表定位使用；不要求跨报告全局唯一。 */
  id: string;

  /** 对应 FormField.key，例如 amount、reason；页面用它查找字段的中文名称。 */
  fieldKey: string;

  /** error 通常表示必填/格式等明确问题；warning 表示业务提醒或需要人工核实的线索。 */
  severity: 'error' | 'warning';

  /** rule 表示代码计算的结果；model 表示经过依据校验后保留的模型提示。 */
  source: 'rule' | 'model';

  /** 给用户阅读的具体说明；模型提示会标明“待核实”，不直接认定违规。 */
  message: string;

  /**
   * 支撑本条发现的内容。
   * 规则结果可以是计算说明，例如“当前值：-420”；模型提示必须能定位到对应字段原文。
   */
  evidence: string;
}

/** 检索命中的一个制度片段，以及回溯到制度版本所需的信息。 */
export interface PolicySource {
  /**
   * 引用标识：检索层可使用原片段 ID；传给模型和返回报告时会映射成 S1、S2 等编号。
   * 这些 S 编号属于本次分析，不能当成文档的永久数据库主键。
   */
  id: string;

  /** 当前制度版本对应的文档记录 ID；与上面的片段引用编号是两种标识。 */
  documentId: string;

  /** 制度标题，配合 version 显示出处，避免只展示一个无法识别的编号。 */
  title: string;

  /** 被引用的制度版本号，而不是永远跟随最新版本的引用。 */
  version: number;

  /** 给用户看的片段序号，从 1 开始；它不是 PDF 页码，内部数组下标则从 0 开始。 */
  chunk: number;

  /** 实际检索到的制度正文片段，用于模型参考和页面展开查看，不是模型生成的摘要。 */
  text: string;

  /** 检索匹配分数，供排序使用；不能当作“制度回答正确率”或模型置信度。 */
  score: number;
}

/** 路线解释中的一步；同一份报告可以同时包含已有历史与后续假设路径。 */
export interface RouteStep {
  /** 对应当前流程快照中的节点 ID，不是 Task ID。 */
  nodeId: string;

  /** 节点或历史事件的可读名称，例如“部门负责人审批”。 */
  label: string;

  /** 实际事件的意见/说明，或模拟步骤的条件判断与假设说明。 */
  detail: string;

  /**
   * actual：来自实例中已保存的历史事件。
   * predicted：解释当前等待节点及后续假设路径，假设后续人工审批同意；不会创建历史或待办。
   */
  mode: 'actual' | 'predicted';
}

/**
 * 五项功能共用的响应结构，前端按 feature 决定重点展示哪些内容。
 * 集合字段统一存在，不适用或没有结果时使用空对象/空数组，减少页面分支判断。
 * 这是 TypeScript 接口；模型原始输出还要经过服务端 output-schema 和业务校验才能进入结果。
 */
export interface AssistantResult {
  /** 服务端生成的报告 ID；成功生成的结果会保存到 assistant_reports。 */
  id: string;

  /** 复用输入协议的功能联合类型，保证输入与输出的功能名称保持一致。 */
  feature: AssistantInput['feature'];

  /** 主体文字：可能是意见草稿、制度回答或检测概述；展示结果不等于已经执行审批。 */
  text: string;

  /** 自然语言填单时可选的申请标题候选，确认后才填入申请标题输入框。 */
  title?: string;

  /** 填单候选值，按业务字段 key 保存；其他功能一般为空对象。金额等数字可返回 number。 */
  fields: Record<string, string | number>;

  /**
   * 与 fields 使用相同 key，记录每个候选值对应的用户原文摘录。
   * 服务端会定位并恢复真实原文；页面展示这些依据，方便用户核对提取是否合理。
   */
  fieldEvidence: Record<string, string>;

  /** 缺失信息、无法确定的事实或需要用户核对的问题清单；不代表业务已被驳回。 */
  questions: string[];

  /** 字段规则结果，以及异常检测功能追加的有效语义提示；没有发现时为空数组。 */
  findings: Finding[];

  /** 已有历史与代码模拟路线；表单不合法、没有流程上下文等情况下可能为空。 */
  route: RouteStep[];

  /** 最终实际引用且通过校验的制度片段，不是整个知识库或本次所有检索候选。 */
  sources: PolicySource[];

  /** 处理过程中的限制或降级提示，例如模型语义检测失败、无依据提示被排除。 */
  warnings: string[];

  /**
   * 服务端对用户、业务快照、候选表单和请求参数等计算的 SHA-256 指纹。
   * 用于比对生成前后的输入是否变化；它不是 Workflow.revision，也不是用户权限凭证。
   */
  inputHash: string;

  /** ISO 时间字符串；当前代码在初始化结果时记录，不能据此当成模型调用完成的精确时刻。 */
  generatedAt: string;

  /** 成功进行模型生成时记录所选对话模型；确定性回答或失败降级时可能不提供。 */
  model?: ModelChoice;

  /** 已执行处理阶段的可读说明，用于展开查看；不是完整 LangGraph 状态或模型隐藏推理。 */
  steps: string[];
}

/**
 * GET /api/assistant/config 返回的公开配置摘要。
 * 可说明默认选择、服务地址和检索模式，但不包含 API Key。
 */
export interface AssistantConfig {
  /** 服务端默认的对话模型；浏览器已保存的有效用户偏好可以覆盖它。 */
  defaultModel: ModelChoice;

  /** 可选择的模型服务；与单次请求中的 ModelChoice.provider 对应。 */
  providers: {
    /** 服务类型，直接复用 ModelChoice 的 provider 类型，避免新增类型时两处不一致。 */
    id: ModelChoice['provider'];

    /** 面向用户的服务名称，例如“本地 Ollama”。 */
    label: string;

    /** 服务端配置的连接地址摘要；请求协议不允许客户端借此提交任意连接 URL。 */
    baseUrl: string;

    /**
     * 是否满足基本配置条件，不代表服务已连通或模型已安装。
     * 当前 Ollama 默认 true，OpenAI 根据服务端是否配置 API Key 判断。
     */
    configured: boolean;
  }[];

  /** 制度检索的独立配置；Embedding 模型用于生成向量，不是负责回答问题的对话模型。 */
  embedding: {
    /** keyword 仅做词项检索；ollama/openai 会额外使用相应服务生成向量。 */
    provider: 'keyword' | 'ollama' | 'openai';

    /** 向量模型名称；keyword 模式下为空字符串，切换对话模型不会自动更换它。 */
    model: string;
  };
}

/**
 * 导入制度的输入校验规则；这里只校验元信息和上传结构。
 * 文档解析、解码后大小、正文有效性、重复版本和管理权限仍由服务端负责检查。
 */
export const policyInputSchema = z
  .object({
    /** 制度名称，去掉首尾空白后为 1～120 字符；也是区分制度版本组的依据之一。 */
    title: z.string().trim().min(1).max(120),

    /**
     * 1～100000 的整数版本号，业务上约定递增，但本 schema 不检查是否比已有版本更大。
     * 同标题、分类、版本号的重复导入由数据库唯一索引拦截。
     */
    version: z.number().int().min(1).max(100000),

    /** all 表示通用制度，其余对应流程业务分类；检索时会同时考虑通用与当前分类。 */
    category: z.enum(['all', 'expense', 'leave', 'purchase', 'custom']),

    /** 开始适用日期，格式为 YYYY-MM-DD 的有效日期字符串，包含当天；不是 Date 对象。 */
    effectiveFrom: z.string().date(),

    /** 最后适用日期，包含当天；省略表示未设置结束日期，稍后的 refine 会检查日期顺序。 */
    effectiveTo: z.string().date().optional(),

    /** 粘贴的制度正文，最多 120000 字符；文件和正文都没提供时会被 refine 拒绝。 */
    content: z.string().max(120000).optional(),

    /**
     * 上传文件的 JSON 表示，避免把浏览器 File 对象直接作为接口数据。
     * file 与 content 允许同时提供；当前导入服务优先解析 file。
     */
    file: z
      .object({
        /** 原文件名，最长 160 字符；服务端依据扩展名选择 TXT/Markdown/PDF/DOCX 解析器。 */
        name: z.string().max(160),

        /**
         * 文件字节的 Base64 编码，限制为最多 6000000 个字符，不是 6000000 字节的文件。
         * 此处只校验字符串长度；解码后最大 4MB 等检查在 PolicyService 中完成。
         */
        base64: z.string().max(6_000_000),
      })
      .optional(),
  })
  // 对象级校验：正文去空白后有内容，或者提供了 file 对象，至少满足一个。
  // 这里检查“是否提供”，不保证文件能解码或正文已满足后续导入要求。
  .refine((v) => Boolean(v.content?.trim() || v.file), '请输入正文或上传制度文档')

  // 两端都已通过 YYYY-MM-DD 格式检查，所以可按字符串顺序比较先后；相等表示只适用一天。
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, '结束日期不能早于生效日期');

/** 导入接口解析后的类型，自动继承上面 schema 的字段、可选项与枚举范围。 */
export type PolicyInput = z.infer<typeof policyInputSchema>;

/**
 * 制度列表/导入成功后返回的元信息，不包含整份正文、内部片段数组或向量数据。
 * 正文片段通过检索结果 PolicySource 按需提供，避免列表返回大量无关内容。
 */
export interface PolicyDocument {
  /** 这份制度版本记录的数据库 ID，新版本另建记录，不直接覆盖旧版本正文。 */
  id: string;

  /** 制度名称，页面展示标题，也参与同一分类下的版本分组。 */
  title: string;

  /** 本条记录的版本号；标题相同不代表引用的是同一个版本。 */
  version: number;

  /** 用索引访问类型复用导入协议的分类范围，避免两处重复维护枚举。 */
  category: PolicyInput['category'];

  /** 生效起始日期，包含当天；检索时结合费用发生日或当前日期判断是否适用。 */
  effectiveFrom: string;

  /** 可选的适用结束日期，包含当天；没有此值时不设置日期上限。 */
  effectiveTo?: string;

  /** 是否启用检索；停用后仍保留记录，可恢复启用，不是永久删除。 */
  enabled: boolean;

  /** 制度记录创建时的 ISO 时间，用于列表展示/排序，与制度生效日期是不同概念。 */
  createdAt: string;

  /** 创建者用户 ID，由接口检查管理权限后传入，不由模型生成。 */
  createdBy: string;

  /** 解析切分后的片段总数，不是某次查询命中的片段数量。 */
  chunks: number;

  /**
   * 导入时的索引配置标识：keyword，或由 provider、服务地址、向量模型名组成的 profile。
   * 查询时只在 profile 匹配的向量空间里比较；不匹配的旧索引仍可参与关键词检索。
   */
  retrieval: string;
}
