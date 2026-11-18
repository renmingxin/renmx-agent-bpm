/**
 * 流程结构摘要：解释节点及审批人，供发起页与详情页复用。
 * 这里只是全部节点说明，实际经过的条件分支以运行历史为准。
 */
'use client';
import { Check, GitBranch } from 'lucide-react';
import { nodeNames, userName, type Definition } from '@bpm/core';
export function RoutePreview({ definition }: { definition: Definition }) {
  return (
    <section className="panel route-preview">
      <div className="section-label">
        <h2>流程说明</h2>
        <GitBranch size={17} />
      </div>
      <p>申请将按照已发布的流程自动流转。</p>
      <ol>
        {definition.nodes.map((n) => (
          <li key={n.id}>
            <span className={`route-node ${n.data.kind}`}>
              {n.data.kind === 'end' ? (
                <Check size={14} />
              ) : n.data.kind === 'condition' ? (
                <GitBranch size={14} />
              ) : (
                <span />
              )}
            </span>
            <div>
              <strong>{n.data.label}</strong>
              <small>
                {n.data.kind === 'approval'
                  ? `审批人 · ${userName(n.data.assignee || '')}`
                  : n.data.kind === 'condition'
                    ? `${definition.fields.find((f) => f.key === n.data.condition?.field)?.label || '数值'} ${n.data.condition?.operator === 'gt' ? '>' : n.data.condition?.operator === 'gte' ? '≥' : n.data.condition?.operator === 'lt' ? '<' : n.data.condition?.operator === 'lte' ? '≤' : '='} ${n.data.condition?.value} 时走满足分支`
                    : nodeNames[n.data.kind]}
              </small>
            </div>
          </li>
        ))}
      </ol>
      {definition.nodes.some((n) => n.data.kind === 'condition') && (
        <div className="info-note">条件节点自动选择一条路径，实际审批路径以流转记录为准。</div>
      )}
    </section>
  );
}
