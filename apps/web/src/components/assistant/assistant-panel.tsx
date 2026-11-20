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

/** 接口 feature 的稳定机器标识映射为界面文字，不把中文展示名发送给后端当作枚举。 */
const labels = {
  draft: '审批意见草稿',
  route: '路线解释',
  fill: '自然语言填单',
  policy: '制度问答',
  anomalies: '异常字段检测',
} as const;
/**
 * 五种能力的公共交互容器。父页面只提供目标、候选值与采用回调，助手不知道业务提交按钮细节。
 * 结果允许部分成功：fields 只含有依据的字段，questions/warnings 解释需要补充或跳过的项。
 */
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
  /** 申请详情使用实例目标，服务端从真实申请读取快照和任务。 */
  instanceId?: string;
  /** 发起前使用流程目标，服务端查找最新发布版本。 */
  workflowId?: string;
  /** 当前表单值随人工编辑变化，保证生成结果能绑定到本次候选状态。 */
  data?: BpmData;
  /** 只用于把字段 key 展示为 label；发布定义与授权仍由服务端重新读取。 */
  fields?: FormField[];
  /** 控制是否展示意见草稿入口，不替代服务端的当前处理人检查。 */
  canDraft?: boolean;
  /** 人确认候选值后调用；父页面只合并返回的字段，不清空被跳过/未提取的字段。 */
  onFill?: (result: AssistantResult) => void;
  /** 把草稿放进可编辑意见框，不自动同意或驳回。 */
  onDraft?: (text: string) => void;
  /** 独立制度库只开放问答，不假装拥有某份申请上下文。 */
  policyOnly?: boolean;
}) {
  const { request, user } = useApp();
  const { choice, update } = useModelChoice();
  // 按页面能力选择缺省功能；发起页优先填单，详情页优先确定性路线预览。
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
  // 只取消本组件发起的浏览器请求，不保证服务端/供应商已经停止计算。
  const pending = useRef<AbortController | null>(null);
  // 回调是否存在描述了父页面能采用哪类结果，避免在只读详情中误展示“自动填单”能力。
  const options = policyOnly
    ? (['policy'] as const)
    : onFill
      ? (['fill', 'anomalies', 'route', 'policy'] as const)
      : canDraft
        ? (['draft', 'route', 'anomalies', 'policy'] as const)
        : (['route', 'anomalies', 'policy'] as const);
  // 本机输入身份标识：任何相关值变化都会让旧报告过期。
  // 这不是后端 inputHash；服务端还要独立核对数据库中的并发变更。
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
  // ref 在异步请求结束时提供最新输入，避免闭包仍拿到请求发出时的旧值。
  currentKey.current = contextKey;
  const stale = Boolean(result && resultKey !== contextKey);
  const needsModel = feature !== 'route' && (feature !== 'anomalies' || semantic);
  useEffect(() => {
    // 输入改变或组件卸载时放弃旧请求。Abort 不当作用户可见的“调用失败”。
    pending.current?.abort();
    setBusy(false);
    setError('');
    return () => pending.current?.abort();
  }, [contextKey]);
  /** 原生表单校验通过后发送一次分析请求；捕获本次 key，结果只能写回仍匹配的上下文。 */
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
        // 即使服务端旧响应比新响应晚到，也不能覆盖用户后来编辑或重新生成的内容。
        setResult(output);
        setResultKey(key);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      // 已取消的旧请求不能把新请求的 busy 状态改回 false。
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  // 渲染顺序：功能选择 → 模型/问题 → 显式生成 → 主体回答 → 规则/路线/候选/来源 → 人工采用。
  // 助手 form 位于父页面业务 form 外面；所有采用按钮都用 type=button，防止误提交审批。
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
