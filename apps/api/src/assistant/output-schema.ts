/**
 * 模型生成内容的统一 schema：既用于 Ollama 原生约束解码，也用于服务端后验校验。
 * 引用是否存在、字段值是否有效仍由业务代码检查，schema 不代替事实核验。
 */
import { z, type FormField } from '@bpm/core';
import { fillEvidenceCandidates, fillDateCandidates } from './fill-validation';
/**
 * 服务端最终解析使用的通用结构。default 补齐不适用的空集合，让各分支共用处理逻辑。
 * 这里不包含 runId/inputHash 等字段：这些可信元数据由应用服务生成，不能由模型伪造。
 */
export const outputSchema = z.object({
  /** 主体回答/草稿；长度受限，避免无限输出被直接存储。 */
  text: z.string().trim().min(1).max(6000),
  title: z.string().max(100).optional(),
  /** 候选字段允许字符串和有限数字，字段白名单与具体值规则还要再结合流程核对。 */
  fields: z.record(z.string(), z.union([z.string().max(5000), z.number().finite()])).default({}),
  /** 模型提出的依据不直接可信；填单修复与异常检测会分别定位到真实原文。 */
  fieldEvidence: z.record(z.string(), z.string().max(1000)).default({}),
  questions: z.array(z.string().max(400)).max(15).default([]),
  /** 只声明模型引用了哪些编号；Service 会检查编号是否确实来自本次检索。 */
  citationIds: z.array(z.string()).max(4).default([]),
  /** 语义问题是带字段依据的待核实提示，不是已证实的违规结论。 */
  anomalies: z
    .array(
      z.object({
        fieldKey: z.string(),
        message: z.string().max(400),
        evidence: z.string().min(1).max(500),
      }),
    )
    .max(15)
    .default([]),
});

/**
 * 根据当前功能生成更严格的原生解码 schema，主要供 Ollama format 使用。
 * 它在“生成时”限制可能输出的结构；上面的 outputSchema 在“收到后”再次校验。
 * 不同 provider 的生成约束能力不同，因此后验校验不能省略。
 */
export function decodingSchema(context: unknown) {
  const input = context as {
    feature?: string;
    userText?: string;
    todayShanghai?: string;
    schema?: FormField[];
    sources?: { id: string }[];
    definition?: { fields: FormField[] };
    fields?: Record<string, string | number>;
  };
  const noItems = z.array(z.string()).max(0).default([]);
  if (input.feature === 'fill') {
    // 相对日期由代码按上海“今天”换算，避免小模型给“昨天”套用训练数据中的旧年份。
    const dates =
      input.todayShanghai && /^\d{4}-\d{2}-\d{2}$/.test(input.todayShanghai)
        ? fillDateCandidates(input.userText || '', input.todayShanghai)
        : [];
    // 填单只能生成已发布表单中的 key；选项字段直接使用原 options 枚举。
    const fields = z
      .object(
        Object.fromEntries(
          (input.schema || []).map((f) => [
            f.key,
            (f.type === 'number'
              ? z.number()
              : f.type === 'date' && dates.length
                ? z.enum(dates as [string, ...string[]])
                : f.type === 'select' && f.options?.length
                  ? z.enum(f.options as [string, ...string[]])
                  : z.string()
            )
              .describe(f.label)
              .optional(),
          ]),
        ),
      )
      .strict()
      .default({});
    // JSON Schema 只能约束结构；这里进一步把依据的取值限定为本次真实原文片段。
    // 字段键也和 fields 对齐，防止模型把中文 label 或说明文字当成证据 key。
    const candidates = fillEvidenceCandidates(input.userText || '');
    const quote = z.enum(candidates as [string, ...string[]]);
    const fieldEvidence = z
      .object(
        Object.fromEntries((input.schema || []).map((field) => [field.key, quote.optional()])),
      )
      .strict()
      .default({});
    return outputSchema.extend({
      fields,
      fieldEvidence,
      citationIds: noItems,
      anomalies: z.array(z.never()).max(0).default([]),
    });
  }
  const ids = input.sources?.map((source) => source.id) || [];
  const keys = input.definition?.fields.map((field) => field.key) || [];
  const values = Object.values(input.fields || {})
    .map(String)
    .filter((value) => value.length > 0 && value.length <= 500);
  // 非填单功能不能生成表单覆盖值；引用编号只能取本次检索的 S1/S2 等编号。
  // 异常证据限定在真实字段值中，但字段/证据是否正确对应还要由 Service 核对。
  return outputSchema.extend({
    fields: z.object({}).strict().default({}),
    fieldEvidence: z.object({}).strict().default({}),
    citationIds: ids.length
      ? z
          .array(z.enum(ids as [string, ...string[]]))
          .max(4)
          .default([])
      : noItems,
    anomalies:
      input.feature === 'anomalies' && keys.length && values.length
        ? z
            .array(
              z.object({
                fieldKey: z.enum(keys as [string, ...string[]]),
                message: z.string().max(400),
                evidence: z.enum(values as [string, ...string[]]),
              }),
            )
            .max(15)
            .default([])
        : z.array(z.never()).max(0).default([]),
  });
}
