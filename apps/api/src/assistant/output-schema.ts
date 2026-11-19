/**
 * 模型生成内容的统一 schema：既用于 Ollama 原生约束解码，也用于服务端后验校验。
 * 引用是否存在、字段值是否有效仍由业务代码检查，schema 不代替事实核验。
 */
import { z, type FormField } from '@bpm/core';
export const outputSchema = z.object({
  text: z.string().trim().min(1).max(6000),
  title: z.string().max(100).optional(),
  fields: z.record(z.string(), z.union([z.string().max(5000), z.number().finite()])).default({}),
  fieldEvidence: z.record(z.string(), z.string().max(1000)).default({}),
  questions: z.array(z.string().max(400)).max(15).default([]),
  citationIds: z.array(z.string()).max(4).default([]),
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

/** 约束解码时把无关字段收紧，防止小模型把原文摘录误塞进 citationIds。 */
export function decodingSchema(context: unknown) {
  const input = context as {
    feature?: string;
    schema?: FormField[];
    sources?: { id: string }[];
    definition?: { fields: FormField[] };
    fields?: Record<string, string | number>;
  };
  const noItems = z.array(z.string()).max(0).default([]);
  if (input.feature === 'fill') {
    const fields = z
      .object(
        Object.fromEntries(
          (input.schema || []).map((f) => [
            f.key,
            (f.type === 'number' ? z.number() : z.string()).optional(),
          ]),
        ),
      )
      .strict()
      .default({});
    return outputSchema.extend({
      fields,
      citationIds: noItems,
      anomalies: z.array(z.never()).max(0).default([]),
    });
  }
  const ids = input.sources?.map((source) => source.id) || [];
  const keys = input.definition?.fields.map((field) => field.key) || [];
  const values = Object.values(input.fields || {})
    .map(String)
    .filter((value) => value.length > 0 && value.length <= 500);
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
