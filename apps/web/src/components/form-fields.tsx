/**
 * 动态表单渲染器：把 FormField schema 映射为原生 HTML 控件。
 * readOnly 显示已提交的值；编辑时采用 defaultValue 和原生 FormData 收集输入。
 * 浏览器 required 等约束改善交互，服务端仍会重新执行 validateForm。
 */
'use client';

import type { FormData as BpmData, FormField } from '@bpm/core';

export function collectFields(form: HTMLFormElement, fields: FormField[]): BpmData {
  const raw = new FormData(form);
  return Object.fromEntries(fields.map((f) => [f.key, String(raw.get(f.key) ?? '')]));
}
export function FormFields({
  fields,
  values = {},
  readOnly = false,
  prefix = 'form',
}: {
  fields: FormField[];
  values?: BpmData;
  readOnly?: boolean;
  prefix?: string;
}) {
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
              defaultValue={values[f.key] ?? ''}
              required={f.required}
              placeholder={f.placeholder || '请输入'}
              maxLength={5000}
              rows={4}
            />
          ) : f.type === 'select' ? (
            <select
              id={`${prefix}-${f.id}`}
              name={f.key}
              defaultValue={values[f.key] ?? ''}
              required={f.required}
            >
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
              defaultValue={values[f.key] ?? ''}
              placeholder={f.placeholder || '请输入'}
              maxLength={5000}
            />
          )}
        </label>
      ))}
    </div>
  );
}
