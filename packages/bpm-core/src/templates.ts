/**
 * 内置模板工厂：返回全新的流程、连线与表单对象。
 * 节点位置仅用于画图，真正执行顺序由 edges 决定；数组顺序不是执行顺序。
 * 费用/采购模板通过 amount > 3000 演示条件分流，其他模板演示最短串行链路。
 */
import type { Definition, GraphNode, GraphEdge } from './types';

export function createTemplate(
  kind: 'expense' | 'leave' | 'purchase' | 'blank',
  name?: string,
): Definition {
  const nodes: GraphNode[] = [
    {
      id: 'start',
      type: 'bpm',
      position: { x: 250, y: 50 },
      data: { kind: 'start', label: '提交申请' },
    },
    {
      id: 'manager',
      type: 'bpm',
      position: { x: 250, y: 210 },
      data: {
        kind: 'approval',
        label: '部门负责人审批',
        assignee: 'u-chen',
        description: '确认申请内容与业务合理性',
      },
    },
    {
      id: 'end',
      type: 'bpm',
      position: { x: 250, y: 690 },
      data: { kind: 'end', label: '流程结束' },
    },
  ];
  const edges: GraphEdge[] = [{ id: 'start-manager', source: 'start', target: 'manager' }];
  const base: Definition = {
    name:
      name ||
      { expense: '费用报销', leave: '请假申请', purchase: '采购申请', blank: '新建流程' }[kind],
    description: '',
    category: kind === 'blank' ? 'custom' : kind,
    nodes,
    edges,
    fields: [],
  };
  if (kind === 'expense' || kind === 'purchase') {
    base.description =
      kind === 'expense'
        ? '差旅、办公与日常费用，一站式报销。'
        : '设备与物资采购，让需求及时落地。';
    base.fields = [
      {
        id: 'f-type',
        key: 'category',
        label: kind === 'expense' ? '报销类型' : '采购类型',
        type: 'select',
        required: true,
        options:
          kind === 'expense'
            ? ['差旅交通', '办公费用', '业务招待', '其他费用']
            : ['办公设备', '软件服务', '办公物资'],
      },
      {
        id: 'f-amount',
        key: 'amount',
        label: kind === 'expense' ? '报销金额（元）' : '采购金额（元）',
        type: 'number',
        required: true,
        placeholder: '请输入金额',
      },
      { id: 'f-date', key: 'date', label: '发生日期', type: 'date', required: true },
      {
        id: 'f-reason',
        key: 'reason',
        label: kind === 'expense' ? '费用说明' : '采购说明',
        type: 'textarea',
        required: true,
        placeholder: '请说明用途、明细等信息',
      },
    ];
    nodes.splice(
      2,
      0,
      {
        id: 'condition',
        type: 'bpm',
        position: { x: 250, y: 370 },
        data: {
          kind: 'condition',
          label: '金额判断',
          condition: { field: 'amount', operator: 'gt', value: 3000 },
        },
      },
      {
        id: 'finance',
        type: 'bpm',
        position: { x: 530, y: 530 },
        data: { kind: 'approval', label: '财务负责人审批', assignee: 'u-wang' },
      },
    );
    edges.push(
      { id: 'manager-condition', source: 'manager', target: 'condition' },
      {
        id: 'condition-finance',
        source: 'condition',
        sourceHandle: 'yes',
        target: 'finance',
        label: '金额 > 3,000',
      },
      {
        id: 'condition-end',
        source: 'condition',
        sourceHandle: 'no',
        target: 'end',
        label: '否则',
      },
      { id: 'finance-end', source: 'finance', target: 'end' },
    );
  } else {
    nodes[2].position.y = 390;
    edges.push({ id: 'manager-end', source: 'manager', target: 'end' });
    base.description =
      kind === 'leave'
        ? '计划好每一次休息，工作交接更从容。'
        : '配置表单与审批节点，构建你的业务流程。';
    base.fields =
      kind === 'leave'
        ? [
            {
              id: 'f-type',
              key: 'category',
              label: '请假类型',
              type: 'select',
              required: true,
              options: ['年假', '事假', '病假', '调休'],
            },
            { id: 'f-start', key: 'startDate', label: '开始日期', type: 'date', required: true },
            { id: 'f-days', key: 'days', label: '请假天数', type: 'number', required: true },
            { id: 'f-reason', key: 'reason', label: '请假事由', type: 'textarea', required: true },
          ]
        : [{ id: 'f-reason', key: 'reason', label: '申请说明', type: 'textarea', required: true }];
  }
  return base;
}
