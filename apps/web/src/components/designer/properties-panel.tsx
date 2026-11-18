/**
 * 右侧属性编辑器：根据选中对象显示节点、连线或表单字段的配置。
 * 所有变更通过父组件提供的 updater 写回；审批人及数字条件来自共享业务模型。
 * 字段顺序只影响表单呈现；流程执行顺序始终由连线决定。
 */
'use client';
import type { Dispatch, SetStateAction } from 'react';
import type { Edge } from '@xyflow/react';
import { Settings2, MousePointer2, TextCursorInput, Trash2 } from 'lucide-react';
import {
  nodeNames,
  users,
  fieldTypes,
  fieldNames,
  type FormField,
  type FieldType,
  type GraphNode,
} from '@bpm/core';
import type { BpmNode } from './nodes';
interface Props {
  tab: 'flow' | 'form';
  activeNode?: BpmNode;
  activeEdge?: Edge;
  activeField?: FormField;
  selectedEdge: string;
  selectedField: string;
  fields: FormField[];
  updateNode: (data: Partial<GraphNode['data']>) => void;
  updateField: (data: Partial<FormField>) => void;
  removeNode: () => void;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setFields: Dispatch<SetStateAction<FormField[]>>;
  setSelectedEdge: (id: string) => void;
  setSelectedField: (id: string) => void;
}
export function PropertiesPanel({
  tab,
  activeNode,
  activeEdge,
  activeField,
  selectedEdge,
  selectedField,
  fields,
  updateNode,
  updateField,
  removeNode,
  setEdges,
  setFields,
  setSelectedEdge,
  setSelectedField,
}: Props) {
  return (
    <aside className="editor-inspector">
      <div className="inspector-heading">
        <span>{tab === 'flow' ? '节点属性' : '字段属性'}</span>
        <Settings2 size={16} />
      </div>
      {tab === 'flow' ? (
        activeNode ? (
          <>
            <div className={`inspector-node-type ${activeNode.data.kind}`}>
              <span>{nodeNames[activeNode.data.kind]}</span>
              <small>{activeNode.id}</small>
            </div>
            <label className="field compact">
              <span>
                节点名称 <em>*</em>
              </span>
              <input
                maxLength={60}
                value={activeNode.data.label}
                onChange={(e) => updateNode({ label: e.target.value })}
              />
            </label>
            {activeNode.data.kind === 'approval' && (
              <>
                <label className="field compact">
                  <span>
                    指定审批人 <em>*</em>
                  </span>
                  <select
                    value={activeNode.data.assignee || ''}
                    onChange={(e) => updateNode({ assignee: e.target.value })}
                  >
                    <option value="">选择一位审批人</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.role}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field compact">
                  <span>节点说明</span>
                  <textarea
                    rows={3}
                    maxLength={300}
                    value={activeNode.data.description || ''}
                    onChange={(e) => updateNode({ description: e.target.value })}
                  />
                </label>
                <div className="info-note">
                  申请流转至此节点后，会自动为指定成员创建待办。审批人同意后继续流转，驳回则结束申请。
                </div>
              </>
            )}
            {activeNode.data.kind === 'condition' && (
              <>
                <label className="field compact">
                  <span>判断字段</span>
                  <select
                    value={activeNode.data.condition?.field || ''}
                    onChange={(e) =>
                      updateNode({
                        condition: {
                          field: e.target.value,
                          operator: activeNode.data.condition?.operator || 'gt',
                          value: activeNode.data.condition?.value ?? 0,
                        },
                      })
                    }
                  >
                    <option value="">选择必填数字字段</option>
                    {fields
                      .filter((f) => f.type === 'number' && f.required)
                      .map((f) => (
                        <option key={f.id} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field compact">
                  <span>判断规则</span>
                  <select
                    value={activeNode.data.condition?.operator || 'gt'}
                    onChange={(e) =>
                      updateNode({
                        condition: {
                          field: activeNode.data.condition?.field || '',
                          operator: e.target.value as 'gt',
                          value: activeNode.data.condition?.value ?? 0,
                        },
                      })
                    }
                  >
                    <option value="gt">大于 &gt;</option>
                    <option value="gte">大于等于 ≥</option>
                    <option value="lt">小于 &lt;</option>
                    <option value="lte">小于等于 ≤</option>
                    <option value="eq">等于 =</option>
                  </select>
                </label>
                <label className="field compact">
                  <span>比较值</span>
                  <input
                    type="number"
                    step="any"
                    value={activeNode.data.condition?.value ?? 0}
                    onChange={(e) =>
                      updateNode({
                        condition: {
                          field: activeNode.data.condition?.field || '',
                          operator: activeNode.data.condition?.operator || 'gt',
                          value: e.target.valueAsNumber,
                        },
                      })
                    }
                  />
                </label>
                <div className="branch-legend">
                  <span>
                    <i />
                    满足条件 → yes 端口
                  </span>
                  <span>
                    <i />
                    否则 → no 端口
                  </span>
                </div>
                <div className="info-note">
                  分别连接「满足」和「否则」端口到不同审批节点或结束节点。引擎自动选择一条路径。
                </div>
              </>
            )}
            {activeNode.data.kind === 'start' && (
              <div className="info-note">
                流程只允许一个开始节点。发起人填写表单并提交后，申请自动流转到下一节点。
              </div>
            )}
            {activeNode.data.kind === 'end' && (
              <div className="info-note">
                到达此节点后，申请状态自动变为「已完成」。结束节点不能连接后续节点。
              </div>
            )}
            <button className="delete-property" onClick={removeNode}>
              <Trash2 size={15} />
              删除当前节点
            </button>
          </>
        ) : activeEdge ? (
          <>
            <label className="field compact">
              <span>连线说明</span>
              <input
                maxLength={100}
                value={typeof activeEdge.label === 'string' ? activeEdge.label : ''}
                onChange={(e) =>
                  setEdges((prev) =>
                    prev.map((edge) =>
                      edge.id === selectedEdge ? { ...edge, label: e.target.value } : edge,
                    ),
                  )
                }
              />
            </label>
            <div className="info-note">
              {activeEdge.sourceHandle === 'yes'
                ? '满足条件分支'
                : activeEdge.sourceHandle === 'no'
                  ? '否则分支'
                  : '顺序流转连线'}
            </div>
            <button
              className="delete-property"
              onClick={() => {
                setEdges((prev) => prev.filter((e) => e.id !== selectedEdge));
                setSelectedEdge('');
              }}
            >
              <Trash2 size={15} />
              删除当前连线
            </button>
          </>
        ) : (
          <div className="inspector-empty">
            <MousePointer2 size={26} />
            <p>
              选择一个节点或连线
              <br />
              在这里编辑属性
            </p>
          </div>
        )
      ) : activeField ? (
        <>
          <label className="field compact">
            <span>
              字段名称 <em>*</em>
            </span>
            <input
              maxLength={60}
              value={activeField.label}
              onChange={(e) => updateField({ label: e.target.value })}
            />
          </label>
          <label className="field compact">
            <span>
              字段标识 <em>*</em>
            </span>
            <input
              spellCheck={false}
              maxLength={50}
              value={activeField.key}
              onChange={(e) => updateField({ key: e.target.value })}
            />
            <small>以英文字母开头，支持数字与下划线</small>
          </label>
          <label className="field compact">
            <span>字段类型</span>
            <select
              value={activeField.type}
              onChange={(e) =>
                updateField({
                  type: e.target.value as FieldType,
                  ...(e.target.value === 'select' && !activeField.options?.length
                    ? { options: ['选项一', '选项二'] }
                    : {}),
                })
              }
            >
              {fieldTypes.map((t) => (
                <option key={t} value={t}>
                  {fieldNames[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={activeField.required}
              onChange={(e) => updateField({ required: e.target.checked })}
            />
            <span>设为必填字段</span>
          </label>
          {activeField.type === 'select' ? (
            <label className="field compact">
              <span>下拉选项（每行一个）</span>
              <textarea
                rows={5}
                value={activeField.options?.join('\n') || ''}
                onChange={(e) => updateField({ options: e.target.value.split('\n') })}
              />
            </label>
          ) : (
            <label className="field compact">
              <span>输入提示</span>
              <input
                maxLength={150}
                value={activeField.placeholder || ''}
                onChange={(e) => updateField({ placeholder: e.target.value })}
              />
            </label>
          )}
          <div className="field-order">
            <button
              className="button"
              disabled={fields[0].id === activeField.id}
              onClick={() =>
                setFields((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((f) => f.id === selectedField);
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  return next;
                })
              }
            >
              上移
            </button>
            <button
              className="button"
              disabled={fields.at(-1)?.id === activeField.id}
              onClick={() =>
                setFields((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((f) => f.id === selectedField);
                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  return next;
                })
              }
            >
              下移
            </button>
          </div>
          <button
            className="delete-property"
            onClick={() => {
              setFields((prev) => prev.filter((f) => f.id !== selectedField));
              setSelectedField('');
            }}
          >
            <Trash2 size={15} />
            删除当前字段
          </button>
        </>
      ) : (
        <div className="inspector-empty">
          <TextCursorInput size={26} />
          <p>
            选择字段编辑属性
            <br />
            或从左侧添加新字段
          </p>
        </div>
      )}
    </aside>
  );
}
