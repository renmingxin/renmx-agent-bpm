/**
 * LangGraph 审批助手：上下文 → 规则 → 制度检索 → 模型 → 输出校验。
 * 图中没有审批/修改数据库的模型工具；只保存建议报告，正式业务仍由 BpmService 执行。
 * 每个图调用使用独立 state，带超时、并发上限和生成后快照复核，避免跨人串数据。
 */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { createHash, randomUUID } from 'node:crypto';
import {
  detectFieldAnomalies,
  explainRoute,
  shanghaiToday,
  definitionSignature,
  locateEvidence,
  type AssistantInput,
  type AssistantResult,
  type Definition,
  type FormData,
  type Instance,
  type PolicySource,
  type Task,
} from '@bpm/core';
import { BpmService } from '../bpm.service';
import { ModelGateway } from './model-gateway';
import { PolicyService } from './policy.service';
import { outputSchema } from './output-schema';
import { fillPrompt, draftPrompt, anomalyPrompt, policyPrompt } from './prompts';
import { validateFillProposal } from './fill-validation';

/** 从真实业务数据读取的授权上下文，不能用模型返回的“身份/流程定义”替代。 */
interface Context {
  /** 已发起申请使用实例快照；发起前使用模板最新发布版本。 */
  definition?: Definition;
  /** 当前保存值或被授权的候选表单。 */
  data: FormData;
  /** 仅申请详情场景存在，用来提供真实历史与当前状态。 */
  instance?: Instance;
  /** 与该实例关联的待办/已办，既用于权限判断，也属于并发变更检查的输入。 */
  tasks: Task[];
  /** 授权主体 + 业务快照 + 请求参数的哈希；模型无法自行声明分析结果“仍有效”。 */
  fingerprint: string;
  /** 本次上海业务日期，供相对日期提取与未来发生日规则使用。 */
  today: string;
}
/**
 * LangGraph 每次 invoke 都拥有独立 state，各节点只返回本节点更新的字段。
 * Annotation 负责描述通道类型；HTTP/schema 与输出业务校验仍是另一层责任。
 */
const State = Annotation.Root({
  /** 已通过请求 schema 规范化的参数。 */
  input: Annotation<AssistantInput>(),
  /** 由接口校验后传入的操作者，不能信任模型提出的 userId。 */
  actor: Annotation<string>(),
  /** prepare 节点读取的真实上下文。 */
  context: Annotation<Context>(),
  /** retrieve 节点命中的制度片段。 */
  sources: Annotation<PolicySource[]>(),
  /** 模型或确定性分支的原始 JSON，故意保持 unknown，不能跳过后验校验。 */
  generated: Annotation<unknown>(),
  /** 可信元数据与经过核验的生成内容组成的公共结果壳。 */
  result: Annotation<AssistantResult>(),
});

@Injectable()
export class AssistantService {
  /** 进程内限流计数：限制昂贵模型调用。多实例部署时应替换成共享限流。 */
  private active = new Map<string, number>();
  /** 编译后的图可复用，具体请求状态通过 invoke 单独传入，不保存在共享成员中。 */
  private readonly graph;
  /** 注册节点并编译编排图；构造时不会请求模型，也不会提前读取任何申请。 */
  constructor(
    @Inject(BpmService) private readonly bpm: BpmService,
    @Inject(ModelGateway) readonly model: ModelGateway,
    @Inject(PolicyService) readonly policies: PolicyService,
  ) {
    this.graph = new StateGraph(State)
      // 1. 服务端读取申请/模板并授权，不接受浏览器或模型自带的流程定义作为事实。
      .addNode('prepare', async (state) => ({
        context: await this.context(state.input, state.actor),
      }))
      .addNode('rules', (state) => {
        // 2. 先由代码提供规则结果与路线，模型只能参考，不能重算后改写执行语义。
        const ctx = state.context;
        const result: AssistantResult = {
          id: `ai_${randomUUID()}`,
          feature: state.input.feature,
          text: '',
          fields: {},
          fieldEvidence: {},
          questions: [],
          findings: ctx.definition ? detectFieldAnomalies(ctx.definition, ctx.data, ctx.today) : [],
          route: [],
          sources: [],
          warnings: [],
          inputHash: ctx.fingerprint,
          generatedAt: new Date().toISOString(),
          steps: ['准备授权上下文', '执行字段规则检查'],
        };
        if (ctx.definition) {
          try {
            result.route = explainRoute(ctx.definition, ctx.data, ctx.instance);
          } catch {
            result.warnings.push('表单不完整或不合法，尚不能模拟后续路线');
          }
        }
        return { result };
      })
      .addNode('retrieve', async (state) => {
        // 3. 只为需要制度的功能检索；填单、路线及纯规则检测不应为无关的 RAG 失败而失败。
        if (
          state.input.feature === 'route' ||
          state.input.feature === 'fill' ||
          (state.input.feature === 'anomalies' && !state.input.semantic)
        )
          return { sources: [] };
        const ctx = state.context;
        const query =
          state.input.text ||
          `${ctx.definition?.name || ''} ${Object.entries(ctx.data)
            .map(([k, v]) => `${k}:${v}`)
            .join(' ')}`;
        const at =
          typeof ctx.data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ctx.data.date)
            ? ctx.data.date
            : ctx.today;
        const sources = (
          await this.policies.search(query, ctx.definition?.category || 'all', at)
        ).map((source, index) => ({ ...source, id: `S${index + 1}` }));
        return {
          sources,
          result: { ...state.result, steps: [...state.result.steps, '按分类/生效期检索制度'] },
        };
      })
      .addNode('generate', async (state, config) => {
        // 4. 确定性结果直接回答；制度没有命中时明确缺证据，不请求模型“补一个答案”。
        if (state.input.feature === 'route')
          return {
            generated: {
              text: '实际历史与后续模拟分开展示；模拟假设后续人工审批均同意，不会执行流转。',
            },
          };
        if (state.input.feature === 'anomalies' && !state.input.semantic)
          return { generated: { text: '已执行确定性字段检查，未执行模型语义检测。' } };
        if (state.input.feature === 'policy' && !state.sources.length)
          return {
            generated: {
              text: '当前未检索到适用的审批制度，无法给出有依据的制度回答。请导入相关制度或换一个更具体的问题。',
            },
          };
        const choice = state.input.model || this.model.config().defaultModel;
        try {
          // 填单只传字段定义与原文，避免小模型把当前空表单误解为“原文什么也没有”。
          // 其他分支也只传所需的定义元信息，不把整个图交给模型自行决定下一节点。
          const payload =
            state.input.feature === 'fill'
              ? {
                  feature: 'fill',
                  schema: state.context.definition!.fields,
                  userText: state.input.text,
                  todayShanghai: state.context.today,
                }
              : {
                  feature: state.input.feature,
                  intent: state.input.intent,
                  userText: state.input.text,
                  todayShanghai: state.context.today,
                  definition: state.context.definition
                    ? {
                        name: state.context.definition.name,
                        category: state.context.definition.category,
                        fields: state.context.definition.fields,
                      }
                    : undefined,
                  fields: state.context.data,
                  rules: state.result.findings,
                  route: state.result.route,
                  sources: state.sources,
                };
          const generated = await this.model.generate(
            choice,
            state.input.feature === 'fill'
              ? fillPrompt
              : state.input.feature === 'draft'
                ? draftPrompt
                : state.input.feature === 'anomalies'
                  ? anomalyPrompt
                  : policyPrompt,
            payload,
            config.signal || AbortSignal.timeout(180000),
          );
          return {
            generated,
            result: {
              ...state.result,
              model: choice,
              steps: [...state.result.steps, 'LangChain 调用所选模型'],
            },
          };
        } catch (error) {
          // 语义检测失败时仍返回代码已检测的问题，但明确告诉用户哪些未检查。
          if (state.input.feature !== 'anomalies') throw error;
          return {
            generated: { text: '已完成规则检查；模型语义检测失败，请核实后重试。' },
            result: {
              ...state.result,
              warnings: [
                ...state.result.warnings,
                error instanceof HttpException ? String(error.message) : '语义模型不可用',
              ],
            },
          };
        }
      })
      .addNode('validate', async (state) => {
        // 5. unknown → 结构校验 → 来源/字段核验 → 快照复查 → 保存建议，顺序不能倒置。
        const parsed = outputSchema.safeParse(state.generated);
        if (!parsed.success)
          throw new BadGatewayException('模型结果不符合助手数据协议，请更换支持 JSON 的模型或重试');
        const out = parsed.data;
        const cited = out.citationIds.map((id) => {
          const source = state.sources.find((s) => s.id === id);
          if (!source) throw new BadGatewayException('模型引用了未检索到的条款，结果已拦截');
          return source;
        });
        if (state.input.feature === 'policy' && state.sources.length && !cited.length)
          throw new BadGatewayException('制度回答缺少有效引用，结果已拦截，请重试');
        const result = {
          ...state.result,
          text: out.text,
          questions: out.questions,
          sources: cited,
          steps: [...state.result.steps, '校验结构、引用与输入版本'],
        };
        if (state.input.feature === 'draft' && state.context.definition) {
          // 防止模型在低金额路径中捏造“进入财务”等不属于当前引擎模拟的节点。
          const allowed = new Set(state.result.route.map((step) => step.nodeId));
          const invalidNode = state.context.definition.nodes.find(
            (node) =>
              node.data.kind === 'approval' &&
              !allowed.has(node.id) &&
              result.text.includes(node.data.label),
          );
          if (invalidNode)
            throw new BadGatewayException(
              '意见草稿描述了不属于当前路线的审批节点，结果已拦截；请重试或更换模型',
            );
          // 当前规则服务只检查表单/路线，没有证明费用“符合标准”的合规计算。
          // 小模型若擅自作出肯定判断，回退到可核实事实和材料核对意见，并显式披露。
          if (
            /(?:符合|满足|未超过|未超出|不超过)[^。；，]{0,24}(?:标准|制度|规定|限额)/.test(
              result.text,
            )
          ) {
            const facts = state.context.definition.fields
              .filter((field) => state.context.data[field.key] !== undefined)
              .map(
                (field) => `${field.label}：${String(state.context.data[field.key]).slice(0, 60)}`,
              )
              .join('；');
            result.text =
              `${state.input.intent === 'approve' ? '建议核对申请后按流程办理。' : '建议先核实申请事项，明确事实后再决定是否驳回。'}申请表单记载：${facts}。请核实适用制度与相关材料，本草稿不表示已完成真实性或合规性核验。`.slice(
                0,
                1000,
              );
            result.warnings.push('模型草稿包含未经规则证实的合规判断，已回退为事实与待核实意见');
          }
        }
        if (state.input.feature === 'fill') {
          // 一项候选无依据时只跳过该项。原有全量 throw 会让 Qwen 的一条错误依据拖垮整份填单。
          const checked = validateFillProposal(
            state.context.definition!.fields,
            state.input.text,
            out,
            state.context.today,
          );
          result.fields = checked.fields;
          result.fieldEvidence = checked.fieldEvidence;
          result.questions = checked.questions;
          result.warnings.push(...checked.warnings);
          const count = Object.keys(checked.fields).length;
          result.text = count
            ? `已提取 ${count} 个有原文依据的候选字段，请核对后填入；其余信息见待确认事项。`
            : '本次没有可核验的候选字段，请补充明确的信息或手动填写；未将缺少依据的内容填入表单。';
          result.title = out.title;
        }
        if (state.input.feature === 'anomalies')
          for (const anomaly of out.anomalies) {
            const field = state.context.definition?.fields.find((f) => f.key === anomaly.fieldKey);
            const quote = field
              ? locateEvidence(String(state.context.data[field.key] ?? ''), anomaly.evidence)
              : undefined;
            if (!field || !quote) {
              result.warnings.push(
                '有一条模型提示缺少对应字段的原文依据，已排除；确定性检查结果仍然有效',
              );
              result.text =
                '已完成字段检查；部分模型提示无法核实，已排除。请查看下方规则与有依据的待核实项。';
              continue;
            }
            result.findings.push({
              id: `model-${result.findings.length}`,
              fieldKey: field.key,
              source: 'model',
              severity: 'warning',
              message: `待核实：${anomaly.message}`,
              evidence: quote,
            });
          }
        // 生成途中别人审批/改表单/发布模板时，拒绝把旧结果当作最新建议。
        const fresh = await this.context(state.input, state.actor);
        if (fresh.fingerprint !== state.context.fingerprint)
          throw new ConflictException('申请或流程版本已变化，请刷新后重新生成');
        const docs = await this.policies.list();
        // 生成期间制度可能被停用或出现新的适用版本，业务快照没变也要独立检查来源新鲜度。
        const at =
          typeof state.context.data.date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(state.context.data.date)
            ? state.context.data.date
            : state.context.today;
        const active = docs.filter(
          (d) => d.enabled && d.effectiveFrom <= at && (!d.effectiveTo || d.effectiveTo >= at),
        );
        if (
          cited.some((source) => {
            const doc = active.find((d) => d.id === source.documentId);
            return (
              !doc ||
              active.some(
                (d) =>
                  d.title === doc.title && d.category === doc.category && d.version > doc.version,
              )
            );
          })
        )
          throw new ConflictException('引用制度已停用或有新的适用版本，请重新生成');
        // 只有全部核验完成才保存；这里仍没有调用 bpm.act/start 等业务写入入口。
        await this.policies.saveReport(state.actor, result);
        return { result };
      })
      // 当前是单向、有限步骤编排，没有自由工具循环；显式边使每一步的先后容易阅读与测试。
      .addEdge(START, 'prepare')
      .addEdge('prepare', 'rules')
      .addEdge('rules', 'retrieve')
      .addEdge('retrieve', 'generate')
      .addEdge('generate', 'validate')
      .addEdge('validate', END)
      .compile();
  }
  /**
   * 加载并校验上下文，生成前后都会调用，用于发现并发审批/发布等变化。
   * instanceId 优先于 workflowId；只有独立制度问答允许没有具体业务目标。
   */
  private async context(input: AssistantInput, actor: string): Promise<Context> {
    let definition: Definition | undefined;
    let instance: Instance | undefined;
    let tasks: Task[] = [];
    let data: FormData = {};
    if (input.instanceId) {
      ({ instance, tasks } = await this.bpm.instance(input.instanceId));
      if (instance!.applicant !== actor && !tasks.some((task) => task.assignee === actor))
        throw new ForbiddenException('你不能读取此申请的助手上下文');
      // 参与人可读不等于当前可审批：起草意见和提交候选覆盖值还要检查当前 pending 处理人。
      const pending = tasks.find((task) => task.status === 'pending');
      if (input.feature === 'draft' && pending?.assignee !== actor)
        throw new ForbiddenException('仅当前待办处理人可生成审批意见');
      if (input.data && pending?.assignee !== actor)
        throw new ForbiddenException('仅当前审批人可以分析修订中的表单');
      definition = instance!.definition;
      data = input.data || instance!.data;
    } else if (input.workflowId) {
      const wf = await this.bpm.workflow(input.workflowId);
      if (!wf.enabled || !wf.versions.length)
        throw new BadRequestException('请选择已发布并启用的流程');
      definition = wf.versions.at(-1)!.definition;
      data = input.data || {};
    } else if (input.feature !== 'policy')
      throw new BadRequestException('该功能需要流程或申请上下文');
    if (input.feature === 'draft' && !instance)
      throw new BadRequestException('审批意见需要已发起的申请');
    if (input.feature === 'fill' && !input.text)
      throw new BadRequestException('请先描述要填写的申请');
    if (input.feature === 'policy' && !input.text) throw new BadRequestException('请输入制度问题');
    if (
      definition &&
      input.data &&
      Object.keys(input.data).some((key) => !definition!.fields.some((f) => f.key === key))
    )
      throw new BadRequestException('候选表单包含未定义字段');
    // 同一用户、相同实例/任务/定义/候选值及请求，才可能具有相同输入指纹。
    // 它用于变更检测，不是数字签名；权限检查仍在每次读取时执行。
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          actor,
          instance,
          tasks,
          def: definition ? definitionSignature(definition) : null,
          data,
          input,
        }),
      )
      .digest('hex');
    return { definition, data, instance, tasks, fingerprint, today: shanghaiToday() };
  }
  /**
   * 单次分析入口：先占并发额度，再执行图，最后无论成功或异常都归还额度。
   * 每人最多 2 个、进程最多 6 个分析；65 秒是整个图的预算，不是每个节点各有 65 秒。
   */
  async run(input: AssistantInput, actor: string) {
    const total = [...this.active.values()].reduce((s, n) => s + n, 0);
    if ((this.active.get(actor) || 0) >= 2 || total >= 6)
      throw new HttpException('助手正在处理其他请求，请稍后重试', 429);
    this.active.set(actor, (this.active.get(actor) || 0) + 1);
    const signal = AbortSignal.timeout(180000);
    try {
      const state = await this.graph.invoke({ input, actor }, { signal, recursionLimit: 10 });
      return state.result;
    } catch (error) {
      if (signal.aborted)
        throw new HttpException('助手分析超时，请缩短输入或更换模型。人工审批仍可使用', 504);
      throw error;
    } finally {
      // 不释放失败请求会造成“模型曾失败一次，用户此后一直被限流”的计数泄漏。
      const active = (this.active.get(actor) || 1) - 1;
      if (active) this.active.set(actor, active);
      else this.active.delete(actor);
    }
  }
}
