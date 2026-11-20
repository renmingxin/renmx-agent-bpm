/**
 * 可独立测试的助手规则：逐字段检查与流程解释始终由代码计算。
 * “异常”是提醒，不会擅自改变原有 validateForm 或审批执行结果。
 *
 * 阅读顺序：shanghaiToday 提供统一日期 → locateEvidence 定位证据 →
 * detectFieldAnomalies 生成规则发现 → explainRoute 调用纯引擎模拟路径。
 * 本模块没有数据库、模型 SDK 或网络依赖，因此可以在单元测试中直接验证边界值。
 */
import { advance } from './engine';
import { validateForm } from './validation';
import type { Definition, FormData, Instance } from './types';
import type { Finding, RouteStep } from './assistant';

/**
 * 返回上海业务日期 YYYY-MM-DD。
 * sv-SE 提供按年月日排列的格式，显式时区避免主机在 UTC 等时区时把“今天”算错一天。
 */
export const shanghaiToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

/**
 * 将模型引用定位到真实原文，只容忍空白差异，不进行同义词或近似数字匹配。
 *
 * @param text 被引用的真实原文，例如用户描述或某个字段的值。
 * @param quote 模型给出的引用，例如“420 元”。
 * @returns 原文中的实际片段，例如“420元”；找不到或引用全为空白时返回 undefined。
 *
 * positions 保存“去掉空白后的下标 → 原文下标”的映射，匹配结束后再恢复原文。
 * 这意味着报告展示的是原始摘录，而不是模型经过排版后重新生成的字符串。
 */
export function locateEvidence(text: string, quote: string): string | undefined {
  const wanted = quote.replace(/\s/g, '');
  // 空引用不能匹配任意文本，否则“没有证据”也可能被当作验证成功。
  if (!wanted) return undefined;
  const positions: number[] = [];
  let normalized = '';
  for (let i = 0; i < text.length; i++)
    if (!/\s/.test(text[i])) {
      normalized += text[i];
      positions.push(i);
    }
  const start = normalized.indexOf(wanted);
  // slice 的结束位置不包含该字符，故末尾原文下标需要 +1。
  return start < 0
    ? undefined
    : text.slice(positions[start], positions[start + wanted.length - 1] + 1);
}

/**
 * 生成可解释的确定性字段问题清单，不调用模型，也不修改 data。
 *
 * @param def 当前发布版本/实例快照，规定字段 key、类型与业务分类。
 * @param data 当前保存值或用户尚未提交的候选值。
 * @param today 业务上的今天；参数可注入，使未来日期等测试不依赖运行当天。
 * @returns Finding 数组：明确格式问题为 error，需要核实的业务线索为 warning。
 */
export function detectFieldAnomalies(
  def: Definition,
  data: FormData,
  today = shanghaiToday(),
): Finding[] {
  const findings: Finding[] = [];
  // 所有规则发现都从一个入口构造，统一 source、编号和缺省严重级别。
  // 编号只用于本份报告内定位，不是跨报告的数据库主键。
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
      // 例如金额不是数字、日期不存在、选项不在列表。该字段格式已不可靠，跳过后续语义规则。
      add(field.key, (e as Error).message, String(data[field.key] ?? '未填写'), 'error');
      continue;
    }
    const value = data[field.key];
    // 可选字段没有填写时，不应被 Number('') === 0 误判为“数值应大于 0”。
    if (value === undefined || String(value).trim() === '') continue;
    // 仅对工程约定的金额/天数字段提示非正数，合法的负温度等自定义数值不受影响。
    if (
      field.type === 'number' &&
      (field.key === 'amount' || field.key === 'days') &&
      Number(value) <= 0
    )
      add(field.key, `${field.label}应大于 0，请核实`, `当前值：${value}`);
    // 已通过日期合法性校验，YYYY-MM-DD 可以按字符串排序比较先后。
    // 请假可能发生在未来，所以这个“发生日”规则仅用于费用报销。
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
  // 同时提供两个日期时再检查顺序，缺少任意一项仍由各自的必填规则负责。
  if (data.startDate && data.endDate && String(data.endDate) < String(data.startDate))
    add('endDate', '结束日期早于开始日期', `${data.endDate} < ${data.startDate}`, 'error');
  return findings;
}

/**
 * 用现有 BPM 纯引擎解释路线，模型不参与决定金额比较或节点选择。
 *
 * @param def 流程定义。对已有申请应传 instance.definition，避免使用后来修改的设计稿。
 * @param data 当前表单值；模拟前重新 validateForm，确保条件比较使用规范化后的数字。
 * @param instance 可选的已有实例；不传时用于发起申请前预览。
 * @returns 真实历史加假设路径。模拟假定后续人工审批均同意，不会写 Task/Instance。
 */
export function explainRoute(def: Definition, data: FormData, instance?: Instance): RouteStep[] {
  // 历史直接来自业务审计，不重新推测或改写已经发生过的判断与审批意见。
  const result: RouteStep[] = instance
    ? instance.history.map((event) => ({
        nodeId: event.nodeId,
        label: event.label,
        detail: event.comment,
        mode: 'actual',
      }))
    : [];
  // 已完成/已驳回申请没有未来步骤，只返回既有事实；不因当前候选表单重新模拟历史。
  if (instance && instance.status !== 'running') return result;
  const clean = validateForm(def.fields, data);
  let from = instance?.currentNodeId ?? def.nodes.find((node) => node.data.kind === 'start')!.id;
  // 新申请从 start 开始；已有申请从当前等待节点开始，并明确提示模拟的审批假设。
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
  // advance 每次经过自动条件节点后停在下一人工节点/终点。
  // 图是无环串行流程，节点总数可作为保守步数上限，防止非法定义导致无限模拟。
  for (let count = 0; count < def.nodes.length; count++) {
    const { next, transitions } = advance(def, from, clean);
    // transitions 是本段跨过的条件判断；next 是这一段最终到达的节点。
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
    // 仅在模拟里假定该人工节点同意，再从它继续推演；没有真正调用审批服务。
    from = next.id;
  }
  throw new Error('流程模拟超出步数上限');
}
