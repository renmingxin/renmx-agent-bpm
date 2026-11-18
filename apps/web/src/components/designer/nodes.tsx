/**
 * React Flow 自定义节点注册表。
 * target 端口接收上游，source 端口连接下游；条件节点用 yes/no 两个 sourceHandle 区分路径。
 * 节点只显示内容，执行逻辑位于共享 engine；不要在节点组件里发起审批请求。
 */
'use client';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Play, UserRoundCheck, GitBranch, CircleCheck } from 'lucide-react';
import { nodeNames, userName, type GraphNode } from '@bpm/core';

export type BpmNode = Node<GraphNode['data'], 'bpm'>;
export const kindIcons = {
  start: Play,
  approval: UserRoundCheck,
  condition: GitBranch,
  end: CircleCheck,
};
export const kindHints = {
  start: '流程从这里开始',
  approval: '交给指定成员处理',
  condition: '根据表单数值分流',
  end: '结束并归档申请',
};
function WorkflowNode({ data, selected }: NodeProps<BpmNode>) {
  const Icon = kindIcons[data.kind];
  return (
    <div className={`workflow-node ${data.kind} ${selected ? 'selected' : ''}`}>
      {data.kind !== 'start' && <Handle type="target" position={Position.Top} />}
      <div className="workflow-node-heading">
        <span>
          <Icon size={17} />
        </span>
        <small>{nodeNames[data.kind]}</small>
        <span className="node-more">···</span>
      </div>
      <strong>{data.label}</strong>
      <p>
        {data.kind === 'approval'
          ? userName(data.assignee || '未指定审批人')
          : data.kind === 'condition'
            ? `当 ${data.condition?.field || '字段'} ${({ gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' } as const)[data.condition?.operator || 'gt']} ${data.condition?.value ?? 0}`
            : data.kind === 'start'
              ? '填写表单后提交'
              : '完成所有流程步骤'}
      </p>
      {data.kind === 'condition' ? (
        <>
          <Handle type="source" id="yes" position={Position.Bottom} style={{ left: '72%' }} />
          <span className="handle-label yes">满足</span>
          <Handle type="source" id="no" position={Position.Bottom} style={{ left: '28%' }} />
          <span className="handle-label no">否则</span>
        </>
      ) : (
        data.kind !== 'end' && <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  );
}
export const nodeTypes = { bpm: WorkflowNode };
