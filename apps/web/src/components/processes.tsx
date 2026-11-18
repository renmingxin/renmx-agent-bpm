/**
 * 设计态流程列表与运行态发起入口。
 * 管理视图编辑 draft；发起视图使用 versions 的最后一个已发布快照。
 * 新建/复制生成独立流程；停用仅禁止新申请，不中断已发起的实例。
 */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Check,
  Copy,
  GitBranch,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { categoryNames, definitionSignature, type DashboardData, type Workflow } from '@bpm/core';
import { formatDate, json, useApp, useRemote } from '@/lib/client';
import { Empty, ErrorState, Loading, ProcessIcon } from './ui';

export function Processes() {
  const router = useRouter();
  const { request, notify } = useApp();
  const { data, error, loading, reload } = useRemote<DashboardData>('/dashboard');
  const [launch, setLaunch] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [template, setTemplate] = useState('blank');
  const [busy, setBusy] = useState('');
  const [formError, setFormError] = useState('');
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => setLaunch(new URLSearchParams(window.location.search).get('start') === '1'), []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') || '');
    setBusy('create');
    setFormError('');
    try {
      const result = await request<Workflow>('/workflows', json('POST', { name, template }));
      modal.current?.close();
      router.push(`/designer/${result.id}`);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function toggle(wf: Workflow) {
    setBusy(wf.id);
    try {
      await request(
        `/workflows/${wf.id}/enabled`,
        json('PATCH', { revision: wf.revision, enabled: !wf.enabled }),
      );
      notify(wf.enabled ? '流程已停用，已有申请继续流转' : '流程已启用');
      reload();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function duplicate(wf: Workflow) {
    setBusy(wf.id);
    try {
      const copy = await request<Workflow>(
        '/workflows',
        json('POST', { name: `${wf.draft.name.slice(0, 50)} · 副本`, template: 'blank' }),
      );
      await request(
        `/workflows/${copy.id}`,
        json('PATCH', {
          revision: copy.revision,
          definition: { ...wf.draft, name: copy.draft.name },
        }),
      );
      notify('已复制为独立草稿');
      router.push(`/designer/${copy.id}`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  const workflows = data.workflows.filter(
    (w) =>
      (!launch || w.enabled) &&
      (filter === 'all' || (filter === 'published' ? w.enabled : !w.enabled)) &&
      `${w.draft.name}${w.draft.description}`.includes(search),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BUILD BETTER TOGETHER</span>
          <h1>
            {launch ? '发起申请' : '流程管理'}
            <span className="heading-dot">.</span>
          </h1>
          <p>
            {launch
              ? '选择一项流程，让你的工作开始向前。'
              : '把业务想法，变成清晰、可执行的协作流程。'}
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setFormError('');
            modal.current?.showModal();
          }}
        >
          <Plus size={17} />
          新建流程
        </button>
      </div>
      <div className="process-page-toolbar">
        <div className="segmented">
          <button className={!launch ? 'active' : ''} onClick={() => setLaunch(false)}>
            <GitBranch size={15} />
            设计与管理
          </button>
          <button
            className={launch ? 'active' : ''}
            onClick={() => {
              setLaunch(true);
              setFilter('all');
            }}
          >
            <Play size={14} />
            发起申请
          </button>
        </div>
        <div className="process-filter">
          <search className="search-box">
            <Search size={16} />
            <label className="sr-only" htmlFor="process-search">
              搜索流程
            </label>
            <input
              id="process-search"
              type="search"
              placeholder="搜索流程名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </search>
          {!launch && (
            <label className="sr-only-label">
              <span className="sr-only">发布状态</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">全部状态</option>
                <option value="published">已发布并启用</option>
                <option value="draft">草稿 / 已停用</option>
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="section-intro">
        <span>{launch ? 'AVAILABLE WORKFLOWS' : 'ALL WORKFLOWS'}</span>
        <small>{workflows.length} 个流程</small>
      </div>
      <div className="process-grid">
        {workflows.map((wf) => {
          const def = launch ? wf.versions.at(-1)!.definition : wf.draft;
          const dirty =
            wf.versions.length > 0 &&
            definitionSignature(wf.draft) !== definitionSignature(wf.versions.at(-1)!.definition);
          return (
            <article key={wf.id} className="process-card">
              <div className="process-card-top">
                <ProcessIcon category={def.category} />
                <span className={`badge ${wf.enabled ? 'completed' : 'draft'}`}>
                  <span className="status-dot" />
                  {wf.enabled
                    ? `已发布 · v${wf.versions.length}`
                    : wf.versions.length
                      ? '已停用'
                      : '草稿'}
                </span>
              </div>
              <span className="process-category">{categoryNames[def.category]}</span>
              <h2>{def.name}</h2>
              <p>{def.description || '为团队搭建一条专属协作流程。'}</p>
              <div className="process-metrics">
                <span>
                  <GitBranch size={14} />
                  {def.nodes.length} 个节点
                </span>
                <span>
                  <Blocks size={14} />
                  {def.fields.length} 个字段
                </span>
                {dirty && <span className="draft-indicator">待发布修改</span>}
              </div>
              <div className="process-card-bottom">
                <small>更新于 {formatDate(wf.updatedAt)}</small>
                <div>
                  {!launch && (
                    <>
                      <button
                        className="icon-button"
                        title="复制流程"
                        aria-label={`复制${def.name}`}
                        disabled={!!busy}
                        onClick={() => duplicate(wf)}
                      >
                        <Copy size={15} />
                      </button>
                      {wf.versions.length > 0 && (
                        <button
                          className="icon-button"
                          title={wf.enabled ? '停用流程' : '启用流程'}
                          aria-label={`${wf.enabled ? '停用' : '启用'}${def.name}`}
                          disabled={!!busy}
                          onClick={() => toggle(wf)}
                        >
                          {wf.enabled ? <Pause size={15} /> : <Play size={15} />}
                        </button>
                      )}
                    </>
                  )}
                  <Link
                    className="row-action"
                    href={launch ? `/start/${wf.id}` : `/designer/${wf.id}`}
                  >
                    {launch ? '发起申请' : '编辑流程'}
                    {launch ? <ArrowUpRight size={14} /> : <Pencil size={14} />}
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
        {!launch && !search && (
          <button
            className="create-card"
            onClick={() => {
              setFormError('');
              modal.current?.showModal();
            }}
          >
            <span>
              <Plus size={27} />
            </span>
            <strong>创建你的下一个流程</strong>
            <p>从一个想法，开始高效协作</p>
          </button>
        )}
      </div>
      {!workflows.length && (
        <Empty
          title="还没有符合条件的流程"
          description="创建一个流程并发布后，就可以开始发起申请。"
        />
      )}
      <div className="process-tip">
        <span>
          <GitBranch size={21} />
        </span>
        <div>
          <strong>设计一次，每一次都井然有序。</strong>
          <p>
            流程发布后即可使用。修改设计不会影响已发起的申请，发布新版本后，新申请自动使用最新版本。
          </p>
        </div>
      </div>
      <dialog ref={modal} className="modal">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">A NEW BEGINNING</span>
            <h2>创建一个新流程</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭新建流程"
            disabled={!!busy}
            onClick={() => modal.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={create} action="/api/workflows" method="post">
          <label className="field">
            <span>
              流程名称 <em>*</em>
            </span>
            <input name="name" placeholder="例如：项目立项申请" required maxLength={60} autoFocus />
          </label>
          <fieldset className="template-choices">
            <legend>选择起点</legend>
            {[
              { id: 'blank', name: '空白流程', description: '从零开始，自由搭建' },
              { id: 'expense', name: '费用报销', description: '含金额分支与财务审批' },
              { id: 'leave', name: '请假申请', description: '简单、清晰的串行审批' },
              { id: 'purchase', name: '采购申请', description: '采购金额分级审批' },
            ].map((t) => (
              <label
                key={t.id}
                className={template === t.id ? 'template-choice selected' : 'template-choice'}
              >
                <input
                  type="radio"
                  name="template"
                  value={t.id}
                  checked={template === t.id}
                  onChange={(e) => setTemplate(e.target.value)}
                />
                <span>
                  <strong>{t.name}</strong>
                  <small>{t.description}</small>
                </span>
                {template === t.id && <Check size={16} />}
              </label>
            ))}
          </fieldset>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button className="button primary full" type="submit" disabled={!!busy}>
            {busy ? '正在创建…' : '创建并开始设计'}
            <ArrowRight size={16} />
          </button>
        </form>
      </dialog>
    </>
  );
}
