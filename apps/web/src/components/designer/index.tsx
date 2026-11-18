/**
 * 设计器状态协调器：React Flow 的画布状态与可持久化 Definition 在这里转换。
 * 只保存 id/type/position/data 等业务字段，过滤 selection/measured 等画布临时状态。
 * 组件拆分为调色板、画布节点、表单画布和属性面板；本文件统一拥有可编辑状态。
 */
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, FileText, GitBranch, LayoutGrid, Play, Save, Upload, X } from 'lucide-react';
import {
  definitionSchema,
  definitionSignature,
  fieldNames,
  nodeNames,
  users,
  validateDefinition,
  type Definition,
  type FieldType,
  type FormField,
  type GraphNode,
  type NodeKind,
  type Workflow,
} from '@bpm/core';
import { json, useApp, useRemote } from '@/lib/client';
import { nodeTypes, type BpmNode } from './nodes';
import { NodePalette } from './palette';
import { FormBuilder } from './form-builder';
import { PropertiesPanel } from './properties-panel';
import { ErrorState, Loading } from '../ui';

const edgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: '#a2adc1' },
  style: { stroke: '#a2adc1', strokeWidth: 1.7 },
  labelStyle: { fontSize: 11, fill: '#758096' },
  labelBgStyle: { fill: '#f8faff' },
  labelBgPadding: [8, 5] as [number, number],
  labelBgBorderRadius: 5,
};

export function Designer() {
  const { id } = useParams<{ id: string }>();
  const { user } = useApp();
  const { data, error, loading, reload } = useRemote<Workflow>(`/workflows/${id}`);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  return (
    <ReactFlowProvider key={`${id}-${user.id}`}>
      <Editor initial={data} />
    </ReactFlowProvider>
  );
}
function Editor({ initial }: { initial: Workflow }) {
  // 编辑状态由单一父组件管理，子面板不会产生相互竞争的副本。
  const { request, notify } = useApp();
  const flow = useReactFlow<BpmNode>();
  const [wf, setWf] = useState(initial);
  const [meta, setMeta] = useState({
    name: initial.draft.name,
    description: initial.draft.description,
    category: initial.draft.category,
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<BpmNode>(initial.draft.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.draft.edges);
  const [fields, setFields] = useState(initial.draft.fields);
  const [tab, setTab] = useState<'flow' | 'form'>('flow');
  const [selected, setSelected] = useState(initial.draft.nodes[1]?.id || '');
  const [selectedEdge, setSelectedEdge] = useState('');
  const [selectedField, setSelectedField] = useState(initial.draft.fields[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(definitionSignature(initial.draft));
  const canvas = useRef<HTMLDivElement>(null);
  // 从画布状态生成纯业务定义，选中状态/测量尺寸不进入数据库。
  const definition: Definition = {
    ...meta,
    fields,
    nodes: nodes.map((n) => ({ id: n.id, type: 'bpm', position: n.position, data: n.data })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle === 'yes' || e.sourceHandle === 'no'
        ? { sourceHandle: e.sourceHandle }
        : {}),
      ...(typeof e.label === 'string' ? { label: e.label } : {}),
    })),
  };
  const dirty = definitionSignature(definition) !== saved;
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const activeNode = nodes.find((n) => n.id === selected);
  const activeEdge = edges.find((e) => e.id === selectedEdge);
  const activeField = fields.find((f) => f.id === selectedField);
  function updateNode(data: Partial<GraphNode['data']>) {
    setNodes((previous) =>
      previous.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...data } } : n)),
    );
  }
  function updateField(data: Partial<FormField>) {
    setFields((previous) => previous.map((f) => (f.id === selectedField ? { ...f, ...data } : f)));
  }
  function addNode(kind: NodeKind, position?: { x: number; y: number }) {
    if (nodes.length >= 50) {
      notify('简易流程最多支持 50 个节点');
      return;
    }
    const id = `node_${crypto.randomUUID().slice(0, 8)}`;
    const field = fields.find((f) => f.type === 'number' && f.required);
    const n: BpmNode = {
      id,
      type: 'bpm',
      position:
        position ||
        flow.screenToFlowPosition({
          x: (canvas.current?.getBoundingClientRect().left || 400) + 160,
          y: (canvas.current?.getBoundingClientRect().top || 170) + 100 + (nodes.length % 3) * 80,
        }),
      data: {
        kind,
        label: nodeNames[kind],
        ...(kind === 'approval' ? { assignee: users[0].id } : {}),
        ...(kind === 'condition'
          ? { condition: { field: field?.key || '', operator: 'gt' as const, value: 0 } }
          : {}),
      },
    };
    setNodes((previous) => [...previous, n]);
    setSelected(id);
    setSelectedEdge('');
  }
  const connect = useCallback(
    (c: Connection) => {
      setEdges((previous) =>
        addEdge(
          {
            ...c,
            id: `edge_${crypto.randomUUID().slice(0, 8)}`,
            label:
              c.sourceHandle === 'yes' ? '满足条件' : c.sourceHandle === 'no' ? '否则' : undefined,
          },
          previous,
        ),
      );
    },
    [setEdges],
  );
  function removeNode() {
    setNodes((prev) => prev.filter((n) => n.id !== selected));
    setEdges((prev) => prev.filter((e) => e.source !== selected && e.target !== selected));
    setSelected('');
  }
  function addField(type: FieldType) {
    if (fields.length >= 30) {
      notify('最多支持 30 个字段');
      return;
    }
    const suffix = crypto.randomUUID().slice(0, 8);
    const field: FormField = {
      id: `f_${suffix}`,
      key: `field_${suffix}`,
      label: fieldNames[type],
      type,
      required: true,
      ...(type === 'select' ? { options: ['选项一', '选项二'] } : {}),
    };
    setFields((prev) => [...prev, field]);
    setSelectedField(field.id);
  }
  /** Kahn 拓扑分层只调整视觉位置，不改变连线或执行顺序。 */
  function layout() {
    const levels = new Map<string, number>();
    const indegree = new Map(
      nodes.map((n) => [n.id, edges.filter((e) => e.target === n.id).length]),
    );
    const queue = nodes.filter((n) => !indegree.get(n.id)).map((n) => n.id);
    queue.forEach((id) => levels.set(id, 0));
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges.filter((e) => e.source === id)) {
        levels.set(e.target, Math.max(levels.get(e.target) || 0, (levels.get(id) || 0) + 1));
        indegree.set(e.target, (indegree.get(e.target) || 0) - 1);
        if (indegree.get(e.target) === 0) queue.push(e.target);
      }
    }
    const rows = new Map<number, number>();
    setNodes((prev) =>
      prev.map((n) => {
        const level = levels.get(n.id) || 0;
        const col = rows.get(level) || 0;
        rows.set(level, col + 1);
        return { ...n, position: { x: 180 + col * 280, y: 50 + level * 175 } };
      }),
    );
    setTimeout(() => flow.fitView({ padding: 0.2, duration: 300 }), 50);
  }
  /** 先保存草稿，再使用服务器返回的新 revision 发布，避免版本冲突。 */
  async function save(publish = false) {
    if (busy) return;
    setError('');
    const parsed = definitionSchema.safeParse(definition);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；'));
      return;
    }
    if (publish) {
      const errors = validateDefinition(parsed.data);
      if (errors.length) {
        setError(errors.join('；'));
        return;
      }
    }
    setBusy(true);
    try {
      let next = wf;
      if (dirty)
        next = await request<Workflow>(
          `/workflows/${wf.id}`,
          json('PATCH', { revision: wf.revision, definition: parsed.data }),
        );
      setWf(next);
      setSaved(definitionSignature(next.draft));
      if (publish) {
        next = await request<Workflow>(
          `/workflows/${wf.id}/publish`,
          json('POST', { revision: next.revision }),
        );
        setWf(next);
      }
      notify(publish ? `v${next.versions.length} 已发布，可以发起申请了` : '草稿已保存');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="editor">
      <header className="editor-header">
        <div className="editor-title">
          <Link href="/processes" className="icon-button" aria-label="返回流程管理">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1>
              {meta.name || '未命名流程'}
              <span className={`badge ${wf.enabled ? 'completed' : 'draft'}`}>
                {wf.versions.length ? `v${wf.versions.length}` : '草稿'}
              </span>
            </h1>
            <small>
              <span className={`save-dot ${dirty ? 'dirty' : ''}`} />
              {dirty ? '有尚未保存的修改' : '所有修改已保存'}
            </small>
          </div>
        </div>
        <div className="editor-actions">
          {wf.enabled && (
            <Link className="button" href={`/start/${wf.id}`}>
              <Play size={14} />
              发起申请
            </Link>
          )}
          <button className="button" disabled={busy} onClick={() => save()}>
            <Save size={15} />
            保存草稿
          </button>
          <button className="button primary" disabled={busy} onClick={() => save(true)}>
            <Upload size={15} />
            {busy ? '正在处理…' : '发布流程'}
          </button>
        </div>
      </header>
      <div className="editor-subbar">
        <div className="editor-tabs">
          <button className={tab === 'flow' ? 'active' : ''} onClick={() => setTab('flow')}>
            <GitBranch size={16} />
            流程设计<span>01</span>
          </button>
          <button className={tab === 'form' ? 'active' : ''} onClick={() => setTab('form')}>
            <FileText size={16} />
            表单设计<span>02</span>
          </button>
        </div>
        <span className="editor-tip">
          {tab === 'flow' ? '连接每一步，让工作自然流转' : '定义数据，让每一份申请表达清晰'}
        </span>
      </div>
      {error && (
        <div className="editor-error" role="alert">
          <span>{error}</span>
          <button className="icon-button" aria-label="关闭错误" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="editor-body">
        <NodePalette
          tab={tab}
          addNode={addNode}
          addField={addField}
          meta={meta}
          setMeta={setMeta}
        />
        {tab === 'flow' ? (
          <div
            className="flow-canvas"
            ref={canvas}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const kind = e.dataTransfer.getData('application/bpm-node') as NodeKind;
              if (kind in nodeNames)
                addNode(kind, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            }}
          >
            <div className="canvas-label">
              <span className="live-dot" />
              流程画布
              <span>
                {nodes.length} 节点 / {edges.length} 连线
              </span>
            </div>
            <button className="button layout-button" onClick={layout}>
              <LayoutGrid size={14} />
              自动排列
            </button>
            <ReactFlow<BpmNode>
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={connect}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={edgeOptions}
              onNodeClick={(_, node) => {
                setSelected(node.id);
                setSelectedEdge('');
              }}
              onEdgeClick={(_, edge) => {
                setSelectedEdge(edge.id);
                setSelected('');
              }}
              onPaneClick={() => {
                setSelected('');
                setSelectedEdge('');
              }}
              onNodesDelete={(deleted) => {
                if (deleted.some((n) => n.id === selected)) setSelected('');
              }}
              isValidConnection={(c) =>
                c.source !== c.target &&
                nodes.find((n) => n.id === c.source)?.data.kind !== 'end' &&
                nodes.find((n) => n.id === c.target)?.data.kind !== 'start'
              }
              fitView
              fitViewOptions={{ padding: 0.16, maxZoom: 0.9 }}
              minZoom={0.3}
              maxZoom={1.6}
              deleteKeyCode={['Backspace', 'Delete']}
              proOptions={{ hideAttribution: false }}
            >
              <Background variant={BackgroundVariant.Dots} color="#cdd5e5" gap={20} size={1} />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(n) =>
                  n.data.kind === 'condition'
                    ? '#f5b85d'
                    : n.data.kind === 'approval'
                      ? '#8299ed'
                      : '#85cbb8'
                }
                maskColor="rgba(245,248,253,.65)"
              />
            </ReactFlow>
          </div>
        ) : (
          <FormBuilder
            meta={meta}
            fields={fields}
            selectedField={selectedField}
            setSelectedField={setSelectedField}
            addField={addField}
          />
        )}
        <PropertiesPanel
          tab={tab}
          activeNode={activeNode}
          activeEdge={activeEdge}
          activeField={activeField}
          selectedEdge={selectedEdge}
          selectedField={selectedField}
          fields={fields}
          updateNode={updateNode}
          updateField={updateField}
          removeNode={removeNode}
          setEdges={setEdges}
          setFields={setFields}
          setSelectedEdge={setSelectedEdge}
          setSelectedField={setSelectedField}
        />
      </div>
      <footer className="editor-footer">
        <span>
          <span className="live-dot" />
          设计态<span className="dot-separator">·</span>
          {fields.length} 个表单字段
        </span>
        <span>
          基于 React Flow 的可视化流程设计器
          <GitBranch size={13} />
        </span>
      </footer>
    </div>
  );
}
