/**
 * 动态表单渲染器：把 FormField schema 映射为原生 HTML 控件。
 * readOnly 显示已提交的值；编辑时支持原生 defaultValue 和带回调的受控输入。
 * 自然语言填单使用受控模式，点击采纳后 values 改变，控件才能同步展示候选字段。
 * 浏览器 required 等约束改善交互，服务端仍会重新执行 validateForm。
 */
'use client';

import type { FormData as BpmData, FormField } from '@bpm/core';
import type { ChangeEvent } from 'react';

/**
 * 提交时只收集 schema 定义的业务 key，忽略标题、按钮和其他页面控件。
 * HTML 控件返回字符串；数字转换与最终合法性仍交给共享校验和服务端处理。
 */
export function collectFields(form: HTMLFormElement, fields: FormField[]): BpmData {
  const raw = new FormData(form);
  return Object.fromEntries(fields.map((f) => [f.key, String(raw.get(f.key) ?? '')]));
}
/**
 * prefix 让同一页面中的编辑/只读区拥有不同控件 id，保持 label 的关联正确。
 * 提供 onValueChange 即启用受控模式：父组件持有唯一值，助手采纳与人工修改走同一状态。
 * 不提供回调时保持原生表单模式；不要在组件存活期间切换这两种模式。
 */
export function FormFields({
  fields,
  values = {},
  readOnly = false,
  prefix = 'form',
  onValueChange,
}: {
  fields: FormField[];
  values?: BpmData;
  readOnly?: boolean;
  prefix?: string;
  onValueChange?: (key: string, value: string) => void;
}) {
  // 空值统一为 ''，避免 React 将受控输入误判为非受控；defaultValue 只影响首次挂载。
  function control(field: FormField) {
    return onValueChange
      ? {
          value: values[field.key] ?? '',
          onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
            onValueChange(field.key, e.target.value),
        }
      : { defaultValue: values[field.key] ?? '' };
  }
  return (
    <div className="dynamic-fields">
      {fields.map((f) => (
        <label
          key={f.id}
          className={`field ${f.type === 'textarea' ? 'wide' : ''}`}
          htmlFor={`${prefix}-${f.id}`}
        >
          <span>
            {f.label}
            {f.required && !readOnly && <em> *</em>}
          </span>
          {readOnly ? (
            <div className="readonly-value">{values[f.key] ?? '—'}</div>
          ) : f.type === 'textarea' ? (
            <textarea
              id={`${prefix}-${f.id}`}
              name={f.key}
              {...control(f)}
              required={f.required}
              placeholder={f.placeholder || '请输入'}
              maxLength={5000}
              rows={4}
            />
          ) : f.type === 'select' ? (
            <select id={`${prefix}-${f.id}`} name={f.key} {...control(f)} required={f.required}>
              <option value="">请选择</option>
              {f.options?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${prefix}-${f.id}`}
              name={f.key}
              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
              step={f.type === 'number' ? 'any' : undefined}
              required={f.required}
              {...control(f)}
              placeholder={f.placeholder || '请输入'}
              maxLength={5000}
            />
          )}
        </label>
      ))}
    </div>
  );
}
