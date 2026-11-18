/**
 * 发起申请页面：读取最新发布版本 → 填写动态表单 → POST 创建实例 → 打开详情。
 * 申请人来自当前演示身份，流程快照与审批人由服务端决定，客户端不能指定。
 */
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, Send, ShieldCheck } from 'lucide-react';
import { type Instance, type Workflow } from '@bpm/core';
import { json, useApp, useRemote } from '@/lib/client';
import { collectFields, FormFields } from '../form-fields';
import { ErrorState, Loading, ProcessIcon } from '../ui';

import { RoutePreview } from './route-preview';
export function StartProcess() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, request, notify } = useApp();
  const { data: wf, error, loading, reload } = useRemote<Workflow>(`/workflows/${id}`);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  if (loading) return <Loading />;
  if (error || !wf) return <ErrorState error={error} retry={reload} />;
  const published = wf.versions.at(-1);
  if (!wf.enabled || !published)
    return <ErrorState error="流程尚未发布或已停用，请先在设计器发布。" retry={reload} />;
  const definition = published.definition;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const payload = {
      title: String(new FormData(form).get('_title')),
      data: collectFields(form, definition.fields),
    };
    setBusy(true);
    setSubmitError('');
    try {
      const instance = await request<Instance>(`/workflows/${id}/instances`, json('POST', payload));
      notify('申请已提交，正在有序流转');
      router.push(`/instances/${instance.id}`);
    } catch (e) {
      setSubmitError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href="/processes?start=1">
        <ArrowLeft size={15} />
        返回流程列表
      </Link>
      <div className="page-heading runtime-heading">
        <div className="heading-with-icon">
          <ProcessIcon category={definition.category} />
          <div>
            <span className="eyebrow">START A WORKFLOW / V{published.version}</span>
            <h1>{definition.name}</h1>
            <p>{definition.description}</p>
          </div>
        </div>
        <span className="badge completed">
          <ShieldCheck size={13} />
          已发布流程
        </span>
      </div>
      <div className="runtime-grid">
        <section className="panel application-panel">
          <div className="panel-heading">
            <div>
              <h2>填写申请</h2>
              <p>
                请完整填写以下信息，标记 <em>*</em> 的为必填项。
              </p>
            </div>
            <span className="applicant-label">
              <span className="mini-avatar">{user.initials}</span>
              {user.name}
            </span>
          </div>
          <form
            key={user.id}
            action={`/api/workflows/${id}/instances`}
            method="post"
            onSubmit={submit}
          >
            <div className="application-fields">
              <label className="field">
                <span>
                  申请标题 <em>*</em>
                </span>
                <input
                  name="_title"
                  required
                  maxLength={100}
                  defaultValue={
                    definition.name.endsWith('申请') ? definition.name : `${definition.name}申请`
                  }
                  placeholder="给这份申请一个清晰的标题"
                />
              </label>
              <div className="form-separator" />
              <FormFields fields={definition.fields} />
            </div>
            {submitError && (
              <div className="form-error padded" role="alert">
                {submitError}
              </div>
            )}
            <div className="form-actions">
              <span>
                <ShieldCheck size={14} />
                提交后将自动进入审批流程
              </span>
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? '正在提交…' : '提交申请'}
                <Send size={15} />
              </button>
            </div>
          </form>
        </section>
        <div>
          <RoutePreview definition={definition} />
          <div className="runtime-tip">
            <ShieldCheck size={19} />
            <p>表单数据和每一次流转都会保存，你可以随时在工作台跟进进度。</p>
          </div>
        </div>
      </div>
    </>
  );
}
