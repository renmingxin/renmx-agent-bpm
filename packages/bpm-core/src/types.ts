/**
 * 业务模型与运行时校验协议。
 * 先阅读 Workflow → PublishedVersion → Instance → Task 的关系，再看 Zod schema。
 * TypeScript 只在编译期检查；schema 在 HTTP 边界拦截错误数据，前后端共用同一套定义。
 */
import { z } from 'zod';
export { z } from 'zod';

export const users = [
  { id: 'u-chen', name: '陈亦舟', role: '部门负责人', department: '产品研发部', initials: '陈' },
  { id: 'u-lin', name: '林晓', role: '产品设计师', department: '产品研发部', initials: '林' },
  { id: 'u-wang', name: '王知远', role: '财务负责人', department: '财务部', initials: '王' },
] as const;
export type User = (typeof users)[number];
export const nodeKinds = ['start', 'approval', 'condition', 'end'] as const;
export type NodeKind = (typeof nodeKinds)[number];
export const nodeNames: Record<NodeKind, string> = {
  start: '发起申请',
  approval: '人工审批',
  condition: '条件分支',
  end: '流程结束',
};
export const fieldTypes = ['text', 'textarea', 'number', 'date', 'select'] as const;
export type FieldType = (typeof fieldTypes)[number];
export const fieldNames: Record<FieldType, string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  date: '日期',
  select: '下拉选择',
};

const id = z.string().min(1).max(80);
export const fieldSchema = z.object({
  id,
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/),
  label: z.string().trim().min(1).max(60),
  type: z.enum(fieldTypes),
  required: z.boolean(),
  placeholder: z.string().max(150).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});
export const graphNodeSchema = z.object({
  id,
  type: z.literal('bpm'),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: z.object({
    kind: z.enum(nodeKinds),
    label: z.string().trim().min(1).max(60),
    assignee: id.optional(),
    description: z.string().max(300).optional(),
    condition: z
      .object({
        field: id,
        operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
        value: z.number().finite(),
      })
      .optional(),
  }),
});
export const graphEdgeSchema = z.object({
  id,
  source: id,
  target: id,
  sourceHandle: z.enum(['yes', 'no']).nullable().optional(),
  label: z.string().max(100).optional(),
});
export const definitionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300),
  category: z.enum(['expense', 'leave', 'purchase', 'custom']),
  nodes: z.array(graphNodeSchema).min(2).max(50),
  edges: z.array(graphEdgeSchema).max(100),
  fields: z.array(fieldSchema).max(30),
});
export type FormField = z.infer<typeof fieldSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type Definition = z.infer<typeof definitionSchema>;
export type FormData = Record<string, string | number>;
export interface PublishedVersion {
  version: number;
  definition: Definition;
  publishedAt: string;
}
/** draft 可编辑，versions 只追加；revision 用于防止覆盖别人的修改。 */
export interface Workflow {
  id: string;
  draft: Definition;
  versions: PublishedVersion[];
  enabled: boolean;
  revision: number;
  updatedAt: string;
  createdAt: string;
}
export type InstanceStatus = 'running' | 'completed' | 'rejected';
export interface AuditEvent {
  id: string;
  nodeId: string;
  label: string;
  action: 'start' | 'approve' | 'reject' | 'condition' | 'complete';
  actor: string;
  comment: string;
  at: string;
  changes?: FormData;
}
/** 一次申请。definition 是发起时快照，不再跟随设计态修改。 */
export interface Instance {
  id: string;
  serial: string;
  workflowId: string;
  version: number;
  definition: Definition;
  title: string;
  applicant: string;
  data: FormData;
  status: InstanceStatus;
  currentNodeId: string;
  createdAt: string;
  updatedAt: string;
  history: AuditEvent[];
}
/** 一个审批步骤。instanceId 指向整份申请，nodeId 指向本次人工节点。 */
export interface Task {
  id: string;
  instanceId: string;
  nodeId: string;
  assignee: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  completedAt?: string;
}
export interface DashboardData {
  workflows: Workflow[];
  instances: Instance[];
  tasks: Task[];
  users: readonly User[];
}
export const inputDataSchema = z.record(
  z.string().max(80),
  z.union([z.string().max(5000), z.number().finite()]),
);
export const startSchema = z.object({
  title: z.string().trim().min(1).max(100),
  data: inputDataSchema,
});
export const actionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(1000).default(''),
  data: inputDataSchema.optional(),
});
export const saveSchema = z.object({
  revision: z.number().int().min(1),
  definition: definitionSchema,
});
export const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  template: z.enum(['expense', 'leave', 'purchase', 'blank']).default('blank'),
});
export const categoryNames = {
  expense: '费用管理',
  leave: '人事行政',
  purchase: '采购管理',
  custom: '自定义流程',
};
export const userName = (userId: string) => users.find((u) => u.id === userId)?.name ?? userId;

/** JSONB 会重排对象键；比较定义内容时必须消除键顺序对 JSON.stringify 的影响。 */
export function definitionSignature(definition: Definition): string {
  return JSON.stringify(definition, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}
