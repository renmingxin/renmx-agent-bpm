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
  validateForm,
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

interface Context {
  definition?: Definition;
  data: FormData;
  instance?: Instance;
  tasks: Task[];
  fingerprint: string;
  today: string;
}
const State = Annotation.Root({
  input: Annotation<AssistantInput>(),
  actor: Annotation<string>(),
  context: Annotation<Context>(),
  sources: Annotation<PolicySource[]>(),
  generated: Annotation<unknown>(),
  result: Annotation<AssistantResult>(),
});

@Injectable()
export class AssistantService {
  private active = new Map<string, number>();
  private readonly graph;
  constructor(
    @Inject(BpmService) private readonly bpm: BpmService,
    @Inject(ModelGateway) readonly model: ModelGateway,
    @Inject(PolicyService) readonly policies: PolicyService,
  ) {
    this.graph = new StateGraph(State)
      .addNode('prepare', async (state) => ({
        context: await this.context(state.input, state.actor),
      }))
      .addNode('rules', (state) => {
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
            config.signal || AbortSignal.timeout(60000),
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
          // 对已知说明字段补充显式“，用于…”短语，只复制原文，不推断未提供的用途。
          const purpose = state.input.text.match(
            /(?:^|[，,。；;\n])(?:用于|用途为)([^。；;\n]{2,300})/,
          );
          if (
            !out.fields.reason &&
            purpose &&
            state.context.definition!.fields.some((field) => field.key === 'reason')
          ) {
            out.fields.reason = purpose[1].trim();
            out.fieldEvidence.reason = purpose[0].replace(/^[，,。；;\n]/, '');
          }
          for (const [key, value] of Object.entries(out.fields)) {
            if (String(value).trim() === '') continue;
            const field = state.context.definition?.fields.find((f) => f.key === key);
            const quote = locateEvidence(state.input.text, out.fieldEvidence[key] || '');
            if (!field || !quote)
              throw new BadGatewayException('填单结果缺少有效字段或原文依据，结果已拦截');
            try {
              if (
                field.type === 'number' &&
                !(quote.match(/[+-]?\d[\d,]*(?:\.\d+)?/g) || []).some(
                  (n) => Number(n.replaceAll(',', '')) === Number(value),
                )
              ) {
                result.questions.push(`「${field.label}」的数字未能与原文核对，请手动填写`);
                continue;
              }
              result.fields[key] = validateForm([{ ...field, required: true }], { [key]: value })[
                key
              ];
              result.fieldEvidence[key] = quote;
            } catch {
              result.questions.push(`「${field.label}」提取值不合法，请手动确认`);
            }
          }
          for (const f of state.context.definition!.fields)
            if (f.required && result.fields[f.key] === undefined)
              result.questions.push(`请确认「${f.label}」`);
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
        await this.policies.saveReport(state.actor, result);
        return { result };
      })
      .addEdge(START, 'prepare')
      .addEdge('prepare', 'rules')
      .addEdge('rules', 'retrieve')
      .addEdge('retrieve', 'generate')
      .addEdge('generate', 'validate')
      .addEdge('validate', END)
      .compile();
  }
  private async context(input: AssistantInput, actor: string): Promise<Context> {
    let definition: Definition | undefined;
    let instance: Instance | undefined;
    let tasks: Task[] = [];
    let data: FormData = {};
    if (input.instanceId) {
      ({ instance, tasks } = await this.bpm.instance(input.instanceId));
      if (instance!.applicant !== actor && !tasks.some((task) => task.assignee === actor))
        throw new ForbiddenException('你不能读取此申请的助手上下文');
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
  async run(input: AssistantInput, actor: string) {
    const total = [...this.active.values()].reduce((s, n) => s + n, 0);
    if ((this.active.get(actor) || 0) >= 2 || total >= 6)
      throw new HttpException('助手正在处理其他请求，请稍后重试', 429);
    this.active.set(actor, (this.active.get(actor) || 0) + 1);
    const signal = AbortSignal.timeout(65000);
    try {
      const state = await this.graph.invoke({ input, actor }, { signal, recursionLimit: 10 });
      return state.result;
    } catch (error) {
      if (signal.aborted)
        throw new HttpException('助手分析超时，请缩短输入或更换模型。人工审批仍可使用', 504);
      throw error;
    } finally {
      const active = (this.active.get(actor) || 1) - 1;
      if (active) this.active.set(actor, active);
      else this.active.delete(actor);
    }
  }
}
