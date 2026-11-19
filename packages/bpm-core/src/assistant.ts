/**
 * 智能助手的公共协议：只放可序列化类型与 Zod 校验，不引入模型 SDK。
 * 五种功能共享同一个结果壳；业务状态仍由原有 BPM API 修改。
 */
import { z } from 'zod';
import { inputDataSchema } from './types';

export const modelChoiceSchema = z.object({
  provider: z.enum(['ollama', 'openai']),
  model: z.string().trim().min(1).max(150),
});
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
export const assistantInputSchema = z.object({
  feature: z.enum(['draft', 'route', 'fill', 'policy', 'anomalies']),
  instanceId: z.string().max(80).optional(),
  workflowId: z.string().max(80).optional(),
  data: inputDataSchema.optional(),
  text: z.string().trim().max(4000).default(''),
  intent: z.enum(['approve', 'reject']).default('approve'),
  model: modelChoiceSchema.optional(),
  // 异常检测可以只跑确定性检查；模型关闭时必须明确标出语义部分未执行。
  semantic: z.boolean().default(true),
});
export type AssistantInput = z.infer<typeof assistantInputSchema>;
export interface Finding {
  id: string;
  fieldKey: string;
  severity: 'error' | 'warning';
  source: 'rule' | 'model';
  message: string;
  evidence: string;
}
export interface PolicySource {
  id: string;
  documentId: string;
  title: string;
  version: number;
  chunk: number;
  text: string;
  score: number;
}
export interface RouteStep {
  nodeId: string;
  label: string;
  detail: string;
  mode: 'actual' | 'predicted';
}
export interface AssistantResult {
  id: string;
  feature: AssistantInput['feature'];
  text: string;
  title?: string;
  fields: Record<string, string | number>;
  fieldEvidence: Record<string, string>;
  questions: string[];
  findings: Finding[];
  route: RouteStep[];
  sources: PolicySource[];
  warnings: string[];
  inputHash: string;
  generatedAt: string;
  model?: ModelChoice;
  steps: string[];
}
export interface AssistantConfig {
  defaultModel: ModelChoice;
  providers: { id: ModelChoice['provider']; label: string; baseUrl: string; configured: boolean }[];
  embedding: { provider: 'keyword' | 'ollama' | 'openai'; model: string };
}
export const policyInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    version: z.number().int().min(1).max(100000),
    category: z.enum(['all', 'expense', 'leave', 'purchase', 'custom']),
    effectiveFrom: z.string().date(),
    effectiveTo: z.string().date().optional(),
    content: z.string().max(120000).optional(),
    file: z.object({ name: z.string().max(160), base64: z.string().max(6_000_000) }).optional(),
  })
  .refine((v) => Boolean(v.content?.trim() || v.file), '请输入正文或上传制度文档')
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, '结束日期不能早于生效日期');
export type PolicyInput = z.infer<typeof policyInputSchema>;
export interface PolicyDocument {
  id: string;
  title: string;
  version: number;
  category: PolicyInput['category'];
  effectiveFrom: string;
  effectiveTo?: string;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
  chunks: number;
  retrieval: string;
}
