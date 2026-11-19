/**
 * 五种能力的统一交互：显示模型、问题、规则结果、路线与可追溯制度片段。
 * 请求绑定页面当前数据；编辑、换人、换模型或切换功能会取消旧请求并标记旧结果过期。
 * 采用按钮只填入候选内容，绝不自动提交申请或审批。
 */
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Check, LoaderCircle, Sparkles } from 'lucide-react';
import type { AssistantInput, AssistantResult, FormData as BpmData, FormField } from '@bpm/core';
import { json, useApp } from '@/lib/client';
import { ModelPicker, useModelChoice } from './model-picker';

const labels = {
  draft: '审批意见草稿',
  route: '路线解释',
  fill: '自然语言填单',
  policy: '制度问答',
  anomalies: '异常字段检测',
} as const;
export function AssistantPanel({
  instanceId,
  workflowId,
  data = {},
  fields = [],
  canDraft = false,
  onFill,
  onDraft,
  policyOnly = false,
}: {
  instanceId?: string;
  workflowId?: string;
  data?: BpmData;
  fields?: FormField[];
  canDraft?: boolean;
  onFill?: (result: AssistantResult) => void;
  onDraft?: (text: string) => void;
  policyOnly?: boolean;
}) {
  const { request, user } = useApp();
  const { choice, update } = useModelChoice();
  const [feature, setFeature] = useState<AssistantInput['feature']>(
    policyOnly ? 'policy' : onFill ? 'fill' : 'route',
  );
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<'approve' | 'reject'>('approve');
  const [semantic, setSemantic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [resultKey, setResultKey] = useState('');
  const pending = useRef<AbortController | null>(null);
  const options = policyOnly
    ? (['policy'] as const)
    : onFill
      ? (['fill', 'anomalies', 'route', 'policy'] as const)
      : canDraft
        ? (['draft', 'route', 'anomalies', 'policy'] as const)
        : (['route', 'anomalies', 'policy'] as const);
  const contextKey = JSON.stringify({
    instanceId,
    workflowId,
    data,
    feature,
    text,
    intent,
    semantic,
    choice,
    user: user.id,
  });
  const currentKey = useRef(contextKey);
  currentKey.current = contextKey;
  const stale = Boolean(result && resultKey !== contextKey);
  const needsModel = feature !== 'route' && (feature !== 'anomalies' || semantic);
  useEffect(() => {
    pending.current?.abort();
    setBusy(false);
    setError('');
    return () => pending.current?.abort();
  }, [contextKey]);
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const controller = new AbortController();
    pending.current = controller;
    const key = contextKey;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const output = await request<AssistantResult>('/assistant/run', {
        ...json('POST', {
          feature,
          ...(instanceId ? { instanceId } : {}),
          ...(workflowId ? { workflowId } : {}),
          // 只读申请人不提交覆盖数据；可编辑表单和新申请才传候选值。
          ...(onFill || canDraft ? { data } : {}),
          text,
          intent,
          semantic,
          ...(needsModel ? { model: choice } : {}),
        }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted && currentKey.current === key) {
        setResult(output);
        setResultKey(key);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="panel assistant-panel">
      <div className="assistant-heading">
        <span className="assistant-mark">
          <Bot size={23} />
        </span>
        <div>
          <h2>审批智能助手</h2>
          <p>读懂申请 · 查找依据 · 辅助决策</p>
        </div>
        <Link href="/assistant" className="text-button">
          制度库
        </Link>
      </div>
      <form aria-label="审批智能助手" action="/api/assistant/run" method="post" onSubmit={generate}>
        <fieldset className="assistant-features">
          <legend className="sr-only">助手功能</legend>
          {options.map((key) => (
            <label key={key} className={feature === key ? 'selected' : ''}>
              <input
                type="radio"
                name="assistantFeature"
                value={key}
                checked={feature === key}
                onChange={() => setFeature(key)}
              />
              <span>{labels[key]}</span>
            </label>
          ))}
        </fieldset>
        <ModelPicker choice={choice} onChange={update} disabled={busy} required={needsModel} />
        {feature === 'draft' && (
          <label className="field">
            <span>意见方向</span>
            <select
              name="draftIntent"
              value={intent}
              onChange={(e) => setIntent(e.target.value as typeof intent)}
            >
              <option value="approve">起草同意意见</option>
              <option value="reject">起草驳回原因</option>
            </select>
          </label>
        )}
        {(feature === 'fill' || feature === 'policy' || feature === 'draft') && (
          <label className="field">
            <span>
              {feature === 'fill'
                ? '描述要填写的申请 *'
                : feature === 'policy'
                  ? '想了解的制度问题 *'
                  : '补充说明（可选）'}
            </span>
            <textarea
              name="assistantText"
              required={feature !== 'draft'}
              rows={3}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                feature === 'fill'
                  ? '例如：申请昨天去客户现场的差旅交通费 420 元，用于项目交付。'
                  : feature === 'policy'
                    ? '例如：差旅报销需要哪些材料？'
                    : '说明你希望在意见中强调的事实'
              }
            />
          </label>
        )}
        {feature === 'anomalies' && (
          <label className="assistant-check">
            <input
              type="checkbox"
              name="semanticCheck"
              checked={semantic}
              onChange={(e) => setSemantic(e.target.checked)}
            />
            <span>同时检测语义矛盾（调用所选模型）</span>
          </label>
        )}
        <div className="assistant-run">
          <small>
            {feature === 'route'
              ? '基于流程快照与当前表单计算，无需模型。'
              : '生成内容请核对，助手不会执行审批或提交申请。'}
          </small>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
            {busy ? '正在分析…' : `生成${labels[feature]}`}
          </button>
          {busy && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                pending.current?.abort();
                setBusy(false);
              }}
            >
              取消等待
            </button>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {result && (
        <div className={`assistant-result ${stale ? 'stale' : ''}`}>
          <div className="assistant-result-label">
            <Check size={15} />
            <strong>{labels[result.feature]}</strong>
            <span>{stale ? '输入已变化，结果已过期' : '基于本次输入'}</span>
          </div>
          <p className="assistant-answer" role="status">
            {result.text}
          </p>
          {result.warnings.map((warning, i) => (
            <p key={i} className="assistant-warning">
              {warning}
            </p>
          ))}
          {result.findings.length > 0 && result.feature === 'anomalies' && (
            <ul className="assistant-findings">
              {result.findings.map((f) => (
                <li key={f.id}>
                  <strong>
                    {f.source === 'rule' ? '规则检查' : '模型待核实'} ·{' '}
                    {fields.find((field) => field.key === f.fieldKey)?.label || f.fieldKey}
                  </strong>
                  <p>{f.message}</p>
                  <small>依据：{f.evidence}</small>
                </li>
              ))}
            </ul>
          )}
          {result.feature === 'anomalies' && !result.findings.length && (
            <p className="info-note">
              本次已执行的检查未发现异常；不代表票据真实或已经符合全部业务制度。
            </p>
          )}
          {result.feature === 'route' && (
            <ol className="assistant-route">
              {result.route.map((step, i) => (
                <li key={`${step.nodeId}-${i}`}>
                  <span>{step.mode === 'actual' ? '实际记录' : '假设路径'}</span>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </li>
              ))}
            </ol>
          )}
          {result.feature === 'fill' && Object.keys(result.fields).length > 0 && (
            <div className="assistant-candidates">
              {Object.entries(result.fields).map(([key, value]) => (
                <div key={key}>
                  <strong>{fields.find((f) => f.key === key)?.label || key}</strong>
                  <span>{value}</span>
                  <small>原文：{result.fieldEvidence[key]}</small>
                </div>
              ))}
            </div>
          )}
          {result.questions.length > 0 && (
            <div className="assistant-questions">
              <strong>待确认事项</strong>
              <ul>
                {[...new Set(result.questions)].map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {result.sources.length > 0 && (
            <div className="assistant-sources">
              <h3>制度依据</h3>
              {result.sources.map((source) => (
                <details key={source.id}>
                  <summary>
                    {source.title} · v{source.version} · 片段 {source.chunk}
                  </summary>
                  <p>{source.text}</p>
                </details>
              ))}
            </div>
          )}
          {result.feature === 'draft' && onDraft && (
            <button
              type="button"
              className="button primary"
              disabled={stale}
              onClick={() => onDraft(result.text)}
            >
              填入审批意见，继续核对
            </button>
          )}
          {result.feature === 'fill' && onFill && (
            <button
              type="button"
              className="button primary"
              disabled={stale || !Object.keys(result.fields).length}
              onClick={() => onFill(result)}
            >
              确认候选值并填入表单
            </button>
          )}
          <details className="assistant-trace">
            <summary>查看本次处理步骤</summary>
            <ol>
              {result.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <small>
              输入指纹：{result.inputHash.slice(0, 16)} ·{' '}
              {result.model ? `${result.model.provider} / ${result.model.model}` : '确定性处理'}
            </small>
          </details>
        </div>
      )}
    </section>
  );
}
