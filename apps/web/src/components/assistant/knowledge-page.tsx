/**
 * 制度中心：管理版本化制度、上传/粘贴文档、启停与制度问答。
 * 文件仅在显式提交时上传；解析、切分与索引全部由服务端完成。
 */
'use client';

import { useState, type FormEvent } from 'react';
import { BookOpen, FileUp } from 'lucide-react';
import type { AssistantConfig, PolicyDocument } from '@bpm/core';
import { json, useApp, useRemote } from '@/lib/client';
import { AssistantPanel } from './assistant-panel';

export function KnowledgePage() {
  const { user, request, notify } = useApp();
  const { data: docs, loading, error, reload } = useRemote<PolicyDocument[]>('/assistant/policies');
  const { data: config } = useRemote<AssistantConfig>('/assistant/config');
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState('');
  const canEdit = user.id === 'u-chen' || user.id === 'u-wang';
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get('file') as File;
    setBusy(true);
    setError('');
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('文件最大 4MB');
      const content = String(fields.get('content') || '').trim();
      if (!content && !file.size) throw new Error('请粘贴制度正文或选择文档');
      let uploaded: { name: string; base64: string } | undefined;
      if (file.size) {
        // 分块编码避免将大数组展开为函数参数，超过浏览器参数上限。
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        uploaded = { name: file.name, base64: btoa(binary) };
      }
      await request(
        '/assistant/policies',
        json('POST', {
          title: String(fields.get('title')),
          version: Number(fields.get('version')),
          category: String(fields.get('category')),
          effectiveFrom: String(fields.get('effectiveFrom')),
          ...(fields.get('effectiveTo') ? { effectiveTo: String(fields.get('effectiveTo')) } : {}),
          ...(uploaded ? { file: uploaded } : { content }),
        }),
      );
      notify('制度已导入并完成索引');
      form.reset();
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(doc: PolicyDocument) {
    setBusy(true);
    setError('');
    try {
      await request(`/assistant/policies/${doc.id}`, json('PATCH', { enabled: !doc.enabled }));
      notify(doc.enabled ? '制度已停用' : '制度已启用');
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KNOWLEDGE FOR BETTER DECISIONS</span>
          <h1>智能助手 · 制度库</h1>
          <p>让每一份建议，有可查的依据。</p>
        </div>
        <BookOpen size={30} />
      </div>
      <div className="assistant-info">
        对话模型可在各助手面板自由选择。当前检索模式：
        <strong>
          {config?.embedding.provider === 'keyword'
            ? '中文关键词检索（无需 Embedding）'
            : `${config?.embedding.provider || '…'} / ${config?.embedding.model || ''}`}
        </strong>
        。更换向量模型后，请以新版本重新导入制度。
      </div>
      <div className="knowledge-grid">
        <div>
          {canEdit && (
            <section className="panel policy-import">
              <h2>
                <FileUp size={19} /> 导入审批制度
              </h2>
              <p>同标题、同分类使用递增版本号。上传文件时优先解析文件；正文不会覆盖既有版本。</p>
              <form
                aria-label="导入审批制度"
                action="/api/assistant/policies"
                method="post"
                onSubmit={upload}
              >
                <label className="field">
                  <span>制度标题 *</span>
                  <input
                    name="title"
                    required
                    maxLength={120}
                    placeholder="例如：差旅费用管理制度"
                  />
                </label>
                <div className="assistant-control-row">
                  <label className="field">
                    <span>版本 *</span>
                    <input
                      name="version"
                      type="number"
                      min={1}
                      max={100000}
                      defaultValue={1}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>业务分类</span>
                    <select name="category">
                      <option value="all">通用制度</option>
                      <option value="expense">费用报销</option>
                      <option value="purchase">采购</option>
                      <option value="leave">请假</option>
                      <option value="custom">自定义流程</option>
                    </select>
                  </label>
                </div>
                <div className="assistant-control-row">
                  <label className="field">
                    <span>生效日期 *</span>
                    <input name="effectiveFrom" type="date" required defaultValue="2026-01-01" />
                  </label>
                  <label className="field">
                    <span>失效日期（可选）</span>
                    <input name="effectiveTo" type="date" />
                  </label>
                </div>
                <label className="field">
                  <span>上传文档（可选，最大 4MB）</span>
                  <input name="file" type="file" accept=".txt,.md,.pdf,.docx" />
                  <small>支持 UTF-8 TXT、Markdown、文本 PDF、DOCX；扫描件请先 OCR。</small>
                </label>
                <label className="field">
                  <span>或粘贴制度正文</span>
                  <textarea
                    name="content"
                    rows={7}
                    maxLength={120000}
                    placeholder="粘贴经过确认的制度内容，至少 20 字符…"
                  />
                </label>
                <button type="submit" className="button primary" disabled={busy}>
                  {busy ? '正在处理…' : '导入并建立索引'}
                </button>
              </form>
            </section>
          )}
          <section className="panel policy-list">
            <div className="section-label">
              <h2>已导入制度</h2>
              <button type="button" className="text-button" onClick={reload}>
                刷新
              </button>
            </div>
            {(actionError || error) && (
              <p className="form-error" role="alert">
                {actionError || error}
              </p>
            )}
            {loading && <p role="status">正在读取制度…</p>}
            {!loading && !docs?.length && (
              <p className="assistant-empty">
                尚未导入制度。导入后可在此问答，审批意见和异常检测也会检索适用条款。
              </p>
            )}
            {docs?.map((doc) => (
              <article key={doc.id}>
                <div>
                  <strong>{doc.title}</strong>
                  <span className={`badge ${doc.enabled ? 'completed' : 'rejected'}`}>
                    {doc.enabled ? '已启用' : '已停用'}
                  </span>
                </div>
                <p>
                  v{doc.version} · {doc.category} · {doc.chunks} 个片段
                </p>
                <small>
                  {doc.effectiveFrom} 起生效{doc.effectiveTo ? `，至 ${doc.effectiveTo}` : ''} ·{' '}
                  {doc.retrieval.startsWith('keyword') ? '关键词索引' : '向量与关键词索引'}
                </small>
                {canEdit && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void toggle(doc)}
                  >
                    {doc.enabled ? '停用' : '启用'}
                  </button>
                )}
              </article>
            ))}
          </section>
        </div>
        <div>
          <AssistantPanel policyOnly key={user.id} />
        </div>
      </div>
    </>
  );
}
