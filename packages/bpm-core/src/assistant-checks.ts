/**
 * 可独立测试的助手规则：逐字段检查与流程解释始终由代码计算。
 * “异常”是提醒，不会擅自改变原有 validateForm 或审批执行结果。
 */
import { advance } from './engine';
import { validateForm } from './validation';
import type { Definition, FormData, Instance } from './types';
import type { Finding, RouteStep } from './assistant';

export const shanghaiToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

/** 小模型常在数字和中文之间插空格；只容忍空白差异，并恢复真正的原文片段。 */
export function locateEvidence(text: string, quote: string): string | undefined {
  const wanted = quote.replace(/\s/g, '');
  if (!wanted) return undefined;
  const positions: number[] = [];
  let normalized = '';
  for (let i = 0; i < text.length; i++)
    if (!/\s/.test(text[i])) {
      normalized += text[i];
      positions.push(i);
    }
  const start = normalized.indexOf(wanted);
  return start < 0
    ? undefined
    : text.slice(positions[start], positions[start + wanted.length - 1] + 1);
}

export function detectFieldAnomalies(
  def: Definition,
  data: FormData,
  today = shanghaiToday(),
): Finding[] {
  const findings: Finding[] = [];
  const add = (
    key: string,
    message: string,
    evidence: string,
    severity: Finding['severity'] = 'warning',
  ) =>
    findings.push({
      id: `rule-${key}-${findings.length}`,
      fieldKey: key,
      source: 'rule',
      severity,
      message,
      evidence,
    });
  for (const field of def.fields) {
    // 单字段校验可以收集所有错误，而不是在第一个缺项处停止。
    try {
      validateForm([field], data);
    } catch (e) {
      add(field.key, (e as Error).message, String(data[field.key] ?? '未填写'), 'error');
      continue;
    }
    const value = data[field.key];
    if (value === undefined || String(value).trim() === '') continue;
    if (
      field.type === 'number' &&
      (field.key === 'amount' || field.key === 'days') &&
      Number(value) <= 0
    )
      add(field.key, `${field.label}应大于 0，请核实`, `当前值：${value}`);
    // 只对已知业务字段应用业务语义，不能把所有自定义数字都当成金额。
    if (
      field.type === 'date' &&
      field.key === 'date' &&
      def.category === 'expense' &&
      String(value) > today
    )
      add(
        field.key,
        '费用发生日期晚于今天，请核实是否为预支或日期填写错误',
        `${value} > ${today}（上海日期）`,
      );
  }
  if (data.startDate && data.endDate && String(data.endDate) < String(data.startDate))
    add('endDate', '结束日期早于开始日期', `${data.endDate} < ${data.startDate}`, 'error');
  return findings;
}

export function explainRoute(def: Definition, data: FormData, instance?: Instance): RouteStep[] {
  const result: RouteStep[] = instance
    ? instance.history.map((event) => ({
        nodeId: event.nodeId,
        label: event.label,
        detail: event.comment,
        mode: 'actual',
      }))
    : [];
  if (instance && instance.status !== 'running') return result;
  const clean = validateForm(def.fields, data);
  let from = instance?.currentNodeId ?? def.nodes.find((node) => node.data.kind === 'start')!.id;
  if (!instance)
    result.push({
      nodeId: from,
      label: '提交申请',
      detail: '以下为以当前表单模拟的路径',
      mode: 'predicted',
    });
  else
    result.push({
      nodeId: from,
      label: def.nodes.find((n) => n.id === from)!.data.label,
      detail: '当前待办；后续路径假设本环节及后续人工节点均同意，未实际执行',
      mode: 'predicted',
    });
  // 每次 advance 在下个人工节点暂停；这里仅模拟，不写 Task 或审批历史。
  for (let count = 0; count < def.nodes.length; count++) {
    const { next, transitions } = advance(def, from, clean);
    for (const transition of transitions)
      result.push({
        nodeId: transition.node.id,
        label: transition.node.data.label,
        detail: transition.detail,
        mode: 'predicted',
      });
    result.push({
      nodeId: next.id,
      label: next.data.label,
      detail: next.data.kind === 'end' ? '所有前置审批同意后结束' : '假设到达此人工审批节点',
      mode: 'predicted',
    });
    if (next.data.kind === 'end') return result;
    from = next.id;
  }
  throw new Error('流程模拟超出步数上限');
}
