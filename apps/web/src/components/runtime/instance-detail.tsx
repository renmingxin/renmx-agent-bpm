/**
 * 运行态详情：展示实例快照、当前待办和历史，并允许指定审批人同意或驳回。
 * 同意可以保存表单修订；驳回必须填写原因。前端展示权限只是体验，后端再次校验。
 * 审批完成后重新读取服务端状态，不在浏览器里自行执行引擎。
 */
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, CheckCheck, ChevronDown, Clock3, GitBranch, X } from 'lucide-react';
import { userName, type Instance, type Task, type FormData as BpmData } from '@bpm/core';
import { formatDate, json, useApp, useRemote } from '@/lib/client';
import { collectFields, FormFields } from '../form-fields';
import { ErrorState, Loading, ProcessIcon, StatusBadge } from '../ui';

import { RoutePreview } from './route-preview';
import { AssistantPanel } from '../assistant/assistant-panel';
export function InstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, request, notify } = useApp();
  const { data, error, loading, reload } = useRemote<{
    instance: Instance;
    tasks: Task[];
  }>(`/instances/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState(false);
  // candidate 只表示本页待核对的改动；取消修改就回到 instance.data，不会提前写回数据库。
  const [candidate, setCandidate] = useState<BpmData | null>(null);
  // AI 草稿与人工意见共用可编辑值，采用草稿不会触发 submit。
  const [comment, setComment] = useState('');
  useEffect(() => {
    // 切换申请、用户，或审批后读到新版本时，旧候选和旧草稿都不能继续冒充当前输入。
    setEditing(false);
    setCandidate(null);
    setComment('');
  }, [id, user.id, data?.instance.updatedAt]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  const { instance, tasks } = data;
  const task = tasks.find((t) => t.status === 'pending');
  const canAct = instance.status === 'running' && task?.assignee === user.id;
  const current = instance.definition.nodes.find((n) => n.id === instance.currentNodeId);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!task || busy) return;
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
    const action = submitter?.value === 'reject' ? 'reject' : 'approve';
    const comment = String(new FormData(form).get('_comment') || '').trim();
    if (action === 'reject' && !comment) {
      setActionError('请填写驳回原因');
      (form.elements.namedItem('_comment') as HTMLTextAreaElement)?.focus();
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const result = await request<Instance>(
        `/tasks/${task.id}/actions`,
        json('POST', {
          action,
          comment,
          ...(action === 'approve' && editing
            ? { data: collectFields(form, instance.definition.fields) }
            : {}),
        }),
      );
      // 写操作成功后重新读取；读取失败不应误报为“审批没有成功”。
      setEditing(false);
      notify(
        result.status === 'completed'
          ? '审批完成，流程已结束'
          : action === 'reject'
            ? '申请已驳回'
            : '审批通过，已流转至下一节点',
      );
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={15} />
        返回工作台
      </Link>
      <div className="page-heading runtime-heading">
        <div className="heading-with-icon">
          <ProcessIcon category={instance.definition.category} />
          <div>
            <span className="eyebrow">
              {instance.serial} / V{instance.version}
            </span>
            <h1>{instance.title}</h1>
            <p>
              {instance.definition.name}
              <span className="dot-separator">·</span>
              {userName(instance.applicant)} 发起于 {formatDate(instance.createdAt, true)}
            </p>
          </div>
        </div>
        <StatusBadge status={instance.status} />
      </div>
      <div className={`instance-banner ${instance.status}`}>
        <span className="instance-banner-icon">
          {instance.status === 'completed' ? (
            <CheckCheck size={24} />
          ) : instance.status === 'rejected' ? (
            <X size={24} />
          ) : (
            <Clock3 size={24} />
          )}
        </span>
        <div>
          <strong>
            {instance.status === 'completed'
              ? '审批已完成，每一步都有迹可循。'
              : instance.status === 'rejected'
                ? '申请已驳回'
                : canAct
                  ? '这份申请正在等待你的审批'
                  : '申请正在有序流转中'}
          </strong>
          <p>
            {instance.status === 'running'
              ? `当前节点：${current?.data.label} · 处理人：${userName(task?.assignee || '')}`
              : instance.status === 'completed'
                ? '所有审批节点已通过，表单与审批记录已归档。'
                : '请在流转记录中查看驳回原因，需要时可重新发起申请。'}
          </p>
        </div>
        {!canAct && instance.status === 'running' && (
          <span className="banner-hint">右上角切换审批人可体验流转</span>
        )}
      </div>
      <div className="runtime-grid detail-grid">
        <div>
          <section className="panel application-panel">
            <form
              key={`${instance.id}-${instance.updatedAt}-${user.id}`}
              action={`/api/tasks/${task?.id}/actions`}
              method="post"
              onSubmit={submit}
            >
              <div className="panel-heading">
                <div>
                  <h2>申请表单</h2>
                  <p>发起时的流程快照 · v{instance.version}</p>
                </div>
                {canAct && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setEditing(!editing);
                      setCandidate(null);
                    }}
                  >
                    {editing ? '取消修改' : '核对并修改表单'}
                  </button>
                )}
              </div>
              <div className="application-fields">
                <FormFields
                  fields={instance.definition.fields}
                  values={editing ? (candidate ?? instance.data) : instance.data}
                  readOnly={!canAct || !editing}
                  prefix="instance"
                  onValueChange={
                    canAct && editing
                      ? (key, value) =>
                          setCandidate((previous) => ({
                            ...(previous || instance.data),
                            [key]: value,
                          }))
                      : undefined
                  }
                />
              </div>
              {canAct && (
                <div className="approval-area">
                  <label className="field">
                    <span>审批意见</span>
                    <textarea
                      name="_comment"
                      rows={3}
                      maxLength={1000}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="留下你的意见，驳回时请说明原因"
                    />
                  </label>
                  {editing && (
                    <div className="info-note">
                      同意后将保存修改后的表单，并以最新表单值进行后续条件判断。修改内容会记录在审批历史中。
                    </div>
                  )}
                  {actionError && (
                    <p className="form-error" role="alert">
                      {actionError}
                    </p>
                  )}
                  <div className="approval-actions">
                    <button
                      type="submit"
                      name="_action"
                      value="reject"
                      formNoValidate
                      className="button danger-outline"
                      disabled={busy}
                    >
                      <X size={16} />
                      驳回申请
                    </button>
                    <button
                      type="submit"
                      name="_action"
                      value="approve"
                      className="button primary"
                      disabled={busy}
                    >
                      <Check size={16} />
                      {busy ? '正在处理…' : '同意并流转'}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </section>
          <AssistantPanel
            key={`${instance.id}-${user.id}`}
            instanceId={instance.id}
            canDraft={Boolean(canAct)}
            data={editing ? (candidate ?? instance.data) : instance.data}
            fields={instance.definition.fields}
            onDraft={
              canAct
                ? (text) => {
                    setComment(text.slice(0, 1000));
                    notify('草稿已填入审批意见，请核对后自行提交');
                  }
                : undefined
            }
          />
          <details className="panel snapshot-panel">
            <summary>
              查看流程快照
              <ChevronDown size={16} />
            </summary>
            <RoutePreview definition={instance.definition} />
          </details>
        </div>
        <section className="panel timeline-panel">
          <div className="section-label">
            <h2>流转记录</h2>
            <span>{instance.history.length} 条记录</span>
          </div>
          <p>每一步决策，清晰可见。</p>
          <ol className="timeline">
            {instance.history.map((event) => (
              <li key={event.id}>
                <span className={`timeline-dot ${event.action}`}>
                  {event.action === 'condition' ? (
                    <GitBranch size={13} />
                  ) : event.action === 'reject' ? (
                    <X size={13} />
                  ) : (
                    <Check size={13} />
                  )}
                </span>
                <div className="timeline-event">
                  <div>
                    <strong>{event.label}</strong>
                    <span>
                      {event.action === 'approve'
                        ? '已同意'
                        : event.action === 'reject'
                          ? '已驳回'
                          : event.action === 'complete'
                            ? '已完成'
                            : event.action === 'start'
                              ? '已提交'
                              : '自动判断'}
                    </span>
                  </div>
                  <small>
                    {event.actor === 'system' ? '流程引擎' : userName(event.actor)}
                    <span className="dot-separator">·</span>
                    {formatDate(event.at, true)}
                  </small>
                  <p>{event.comment}</p>
                  {event.changes && (
                    <div className="audit-changes">
                      表单修改：
                      {Object.entries(event.changes)
                        .map(
                          ([key, value]) =>
                            `${instance.definition.fields.find((f) => f.key === key)?.label || key} → ${value}`,
                        )
                        .join('；')}
                    </div>
                  )}
                </div>
              </li>
            ))}
            {instance.status === 'running' && (
              <li className="pending-event">
                <span className="timeline-dot pending">
                  <Clock3 size={13} />
                </span>
                <div className="timeline-event">
                  <div>
                    <strong>{current?.data.label}</strong>
                    <span>待处理</span>
                  </div>
                  <small>{userName(task?.assignee || '')} · 等待审批</small>
                </div>
              </li>
            )}
          </ol>
        </section>
      </div>
    </>
  );
}
