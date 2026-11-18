/**
 * 表单设计画布：选择字段、展示排列，并复用真实 FormFields 做预览。
 * 可视化占位仅负责设计体验；发起和审批页面使用同一个 schema 渲染实际表单。
 */
'use client';
import { ChevronRight, Play, Plus } from 'lucide-react';
import { fieldNames, type Definition, type FormField, type FieldType } from '@bpm/core';
import { FormFields } from '../form-fields';
interface Props {
  meta: Pick<Definition, 'name'>;
  fields: FormField[];
  selectedField: string;
  setSelectedField: (id: string) => void;
  addField: (type: FieldType) => void;
}
export function FormBuilder({ meta, fields, selectedField, setSelectedField, addField }: Props) {
  return (
    <div className="form-builder">
      <div className="form-builder-heading">
        <span>FORM BUILDER</span>
        <h2>{meta.name}</h2>
        <p>每一份清晰的申请，都从一张好表单开始。</p>
      </div>
      <div className="builder-field-list">
        {fields.map((f, index) => (
          <button
            className={`builder-field ${selectedField === f.id ? 'selected' : ''}`}
            key={f.id}
            onClick={() => setSelectedField(f.id)}
          >
            <span className="builder-field-index">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>
                {f.label}
                {f.required && <em> *</em>}
              </strong>
              <div className={`field-placeholder ${f.type}`}>
                {f.type === 'select'
                  ? '请选择'
                  : f.type === 'date'
                    ? '年 / 月 / 日'
                    : f.placeholder || '请输入'}
                {f.type === 'select' && <ChevronRight size={14} />}
              </div>
            </div>
            <span className="field-type-tag">{fieldNames[f.type]}</span>
          </button>
        ))}
      </div>
      <button className="add-field-button" onClick={() => addField('text')}>
        <Plus size={17} />
        添加表单字段
      </button>
      <details className="form-preview">
        <summary>
          <Play size={14} />
          预览实际表单
        </summary>
        <FormFields fields={fields} prefix="preview" />
      </details>
    </div>
  );
}
