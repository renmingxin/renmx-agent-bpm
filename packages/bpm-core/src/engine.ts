/**
 * 无副作用的串行流程引擎：给定快照、当前位置和表单，计算下一个人工节点或终点。
 * 这里不读写数据库，也不创建任务；可独立做单元测试。
 * 自动条件节点会被连续执行，直到需要人处理的位置才暂停。
 */
import type { Definition, FormData, GraphNode } from './types';

export interface Transition {
  node: GraphNode;
  detail: string;
}
/** 从已完成节点沿连线继续执行，直到下一个人工节点或终点；不产生数据库副作用。 */
export function advance(
  def: Definition,
  from: string,
  data: FormData,
): { transitions: Transition[]; next: GraphNode } {
  const transitions: Transition[] = [];
  let current = def.nodes.find((n) => n.id === from);
  // 防御性上限：即使错误传入循环图，也要在有限步数内失败。
  for (let guard = 0; guard <= def.nodes.length; guard++) {
    if (!current) throw new Error('运行节点不存在');
    let out = def.edges.filter((e) => e.source === current!.id);
    if (current.data.kind === 'condition') {
      const c = current.data.condition;
      if (!c || data[c.field] === undefined) throw new Error('条件字段缺失');
      const value = Number(data[c.field]);
      const matched = {
        gt: value > c.value,
        gte: value >= c.value,
        lt: value < c.value,
        lte: value <= c.value,
        eq: value === c.value,
      }[c.operator];
      transitions.push({
        node: current,
        detail: `${def.fields.find((f) => f.key === c.field)?.label ?? c.field} = ${value}，${matched ? '满足条件' : '进入否则分支'}`,
      });
      // 分流依赖端口 ID；显示文字 label 不参与运行判断。
      out = out.filter((e) => e.sourceHandle === (matched ? 'yes' : 'no'));
    }
    if (out.length !== 1) throw new Error('流程路径不唯一或未连接');
    current = def.nodes.find((n) => n.id === out[0].target);
    if (!current) throw new Error('目标节点不存在');
    if (current.data.kind === 'approval' || current.data.kind === 'end')
      return { transitions, next: current };
  }
  throw new Error('流程存在循环');
}
