/**
 * 发布前图校验与提交时表单校验。
 * 草稿可以暂时未连接完整；只有通过 validateDefinition 的流程才能发布。
 * validateForm 只保留定义中声明的字段，防止请求夹带额外业务数据。
 */
import { users, type Definition, type FormData, type FormField } from './types';

/** Publication gate: only finite, connected, executable DAGs become runtime snapshots. */
export function validateDefinition(def: Definition): string[] {
  const errors: string[] = [];
  const start = def.nodes.filter((n) => n.data.kind === 'start');
  if (start.length !== 1) errors.push('流程必须且只能有一个开始节点');
  if (!def.nodes.some((n) => n.data.kind === 'end')) errors.push('请添加结束节点');
  if (new Set(def.nodes.map((n) => n.id)).size !== def.nodes.length)
    errors.push('节点 ID 不能重复');
  if (new Set(def.edges.map((e) => e.id)).size !== def.edges.length)
    errors.push('连线 ID 不能重复');
  if (new Set(def.fields.map((f) => f.id)).size !== def.fields.length)
    errors.push('表单字段 ID 不能重复');
  if (new Set(def.fields.map((f) => f.key)).size !== def.fields.length)
    errors.push('表单字段标识不能重复');
  for (const field of def.fields) {
    if (['constructor', 'prototype', '__proto__'].includes(field.key))
      errors.push(`字段 ${field.label} 使用了保留标识`);
    if (
      field.type === 'select' &&
      (!field.options?.length || new Set(field.options).size !== field.options.length)
    )
      errors.push(`${field.label} 需要不重复的选项`);
  }
  for (const edge of def.edges)
    if (
      !def.nodes.some((n) => n.id === edge.source) ||
      !def.nodes.some((n) => n.id === edge.target)
    )
      errors.push('存在连接到已删除节点的连线');
  for (const node of def.nodes) {
    const out = def.edges.filter((e) => e.source === node.id);
    const incoming = def.edges.filter((e) => e.target === node.id);
    const { kind, label } = node.data;
    if (kind === 'start' && incoming.length) errors.push(`${label} 不能有入线`);
    if (kind !== 'start' && !incoming.length) errors.push(`${label} 缺少入线`);
    if (kind === 'end' && out.length) errors.push(`${label} 不能有出线`);
    if ((kind === 'start' || kind === 'approval') && out.length !== 1)
      errors.push(`${label} 需要一条出线`);
    if (kind === 'approval' && !users.some((u) => u.id === node.data.assignee))
      errors.push(`${label} 需要指定审批人`);
    if (kind === 'condition') {
      if (
        out.length !== 2 ||
        !out.some((e) => e.sourceHandle === 'yes') ||
        !out.some((e) => e.sourceHandle === 'no')
      )
        errors.push(`${label} 需要「满足」和「否则」两条分支`);
      const c = node.data.condition;
      if (!c || !def.fields.some((f) => f.key === c.field && f.type === 'number' && f.required))
        errors.push(`${label} 的条件必须引用一个必填数字字段`);
    } else if (out.some((e) => e.sourceHandle)) errors.push(`${label} 不能使用条件分支端口`);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  const walk = (nodeId: string) => {
    if (stack.has(nodeId)) {
      errors.push('简易流程暂不支持循环，请移除回路');
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    stack.add(nodeId);
    def.edges.filter((e) => e.source === nodeId).forEach((e) => walk(e.target));
    stack.delete(nodeId);
  };
  // Check all components for cycles, and separately check reachability from start.
  def.nodes.forEach((n) => walk(n.id));
  const reachable = new Set<string>();
  const reach = (nodeId: string) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    def.edges.filter((e) => e.source === nodeId).forEach((e) => reach(e.target));
  };
  if (start[0]) reach(start[0].id);
  if (reachable.size !== def.nodes.length) errors.push('所有节点都必须能从开始节点到达');
  return [...new Set(errors)];
}

export function validateForm(fields: FormField[], raw: FormData): FormData {
  const clean: FormData = {};
  for (const f of fields) {
    const value = raw[f.key];
    if (value === undefined || String(value).trim() === '') {
      if (f.required) throw new Error(`请填写「${f.label}」`);
      continue;
    }
    if (f.type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new Error(`「${f.label}」必须是有效数字`);
      clean[f.key] = n;
    } else {
      const text = String(value).trim();
      if (
        f.type === 'date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
          Number.isNaN(Date.parse(text)) ||
          new Date(text).toISOString().slice(0, 10) !== text)
      )
        throw new Error(`「${f.label}」需要有效日期`);
      if (f.type === 'select' && !f.options?.includes(text))
        throw new Error(`请选择有效的「${f.label}」`);
      if (text.length > 5000) throw new Error(`「${f.label}」内容过长`);
      clean[f.key] = text;
    }
  }
  return clean;
}
