/**
 * 左侧组件库与流程元信息面板。
 * 点击和拖拽都向父组件传递节点类型；本组件不直接修改 React Flow 内部状态。
 * 表单组件按钮调用 addField，流程名称/说明/分类通过受控 props 更新。
 */
'use client';
import type { Dispatch, SetStateAction } from 'react';
import { GripVertical, Settings2, MousePointer2, Hash, List, Type, Plus } from 'lucide-react';
import {
  fieldTypes,
  fieldNames,
  nodeNames,
  type Definition,
  type FieldType,
  type NodeKind,
} from '@bpm/core';
import { kindIcons, kindHints } from './nodes';
type Meta = Pick<Definition, 'name' | 'description' | 'category'>;
interface Props {
  tab: 'flow' | 'form';
  addNode: (kind: NodeKind) => void;
  addField: (type: FieldType) => void;
  meta: Meta;
  setMeta: Dispatch<SetStateAction<Meta>>;
}
export function NodePalette({ tab, addNode, addField, meta, setMeta }: Props) {
  return (
    <aside className="editor-palette">
      <div className="palette-heading">
        <span>{tab === 'flow' ? '节点组件' : '表单组件'}</span>
        <span>{tab === 'flow' ? 'NODES' : 'FIELDS'}</span>
      </div>
      <p>{tab === 'flow' ? '点击添加，或拖拽到画布' : '点击组件，添加到表单'}</p>
      {tab === 'flow'
        ? (['start', 'approval', 'condition', 'end'] as NodeKind[]).map((kind) => {
            const Icon = kindIcons[kind];
            return (
              <button
                key={kind}
                className={`palette-node ${kind}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/bpm-node', kind);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => addNode(kind)}
              >
                <span>
                  <Icon size={19} />
                </span>
                <div>
                  <strong>{nodeNames[kind]}</strong>
                  <small>{kindHints[kind]}</small>
                </div>
                <GripVertical size={14} />
              </button>
            );
          })
        : fieldTypes.map((type) => (
            <button className="palette-field" key={type} onClick={() => addField(type)}>
              {type === 'number' ? (
                <Hash size={17} />
              ) : type === 'select' ? (
                <List size={17} />
              ) : (
                <Type size={17} />
              )}
              <span>{fieldNames[type]}</span>
              <Plus size={14} />
            </button>
          ))}
      <div className="palette-divider" />
      <div className="palette-heading">
        <span>流程信息</span>
        <Settings2 size={14} />
      </div>
      <label className="field compact">
        <span>流程名称</span>
        <input
          name="workflowName"
          maxLength={60}
          value={meta.name}
          onChange={(e) => setMeta((prev) => ({ ...prev, name: e.target.value }))}
        />
      </label>
      <label className="field compact">
        <span>流程说明</span>
        <textarea
          name="workflowDescription"
          rows={3}
          maxLength={300}
          value={meta.description}
          onChange={(e) => setMeta((prev) => ({ ...prev, description: e.target.value }))}
        />
      </label>
      <label className="field compact">
        <span>业务分类</span>
        <select
          value={meta.category}
          onChange={(e) =>
            setMeta((prev) => ({ ...prev, category: e.target.value as Definition['category'] }))
          }
        >
          <option value="expense">费用管理</option>
          <option value="leave">人事行政</option>
          <option value="purchase">采购管理</option>
          <option value="custom">自定义流程</option>
        </select>
      </label>
      <div className="palette-note">
        <MousePointer2 size={17} />
        <p>
          {tab === 'flow'
            ? '选中节点编辑属性；从底部端口拖到下个节点顶部连接。选中节点或连线后可按 Delete 删除。'
            : '字段标识用于条件判断；发布前请检查必填项和下拉选项。'}
        </p>
      </div>
    </aside>
  );
}
