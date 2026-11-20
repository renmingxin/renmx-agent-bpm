/**
 * 模型选择控件与持久化 hook：只保存 provider/model，不收集或保存 API Key。
 * 可从服务发现模型，也可手动输入；列表失败不会阻止兼容服务上的自定义模型。
 */
'use client';

import { useEffect, useId, useState } from 'react';
import { modelChoiceSchema, type AssistantConfig, type ModelChoice } from '@bpm/core';
import { useRemote } from '@/lib/client';

/**
 * 模型偏好与业务用户数据分开保存：这里只保存 provider/model，绝不保存密钥或申请内容。
 * 组件首次取得服务端配置后，以合法的本机偏好覆盖默认值；损坏的 JSON/不合法枚举会回退。
 */
export function useModelChoice() {
  const { data: config } = useRemote<AssistantConfig>('/assistant/config');
  const [choice, setChoice] = useState<ModelChoice>({ provider: 'ollama', model: 'qwen3.5:2b' });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // 只初始化一次，否则刷新配置时可能覆盖用户正在输入的模型名称。
    if (!config || loaded) return;
    let selected = config.defaultModel;
    try {
      const parsed = modelChoiceSchema.safeParse(
        JSON.parse(localStorage.getItem('bpm-assistant-model') || 'null'),
      );
      if (parsed.success) selected = parsed.data;
    } catch {
      /* 损坏的本地偏好回退到服务端默认配置。 */
    }
    setChoice(selected);
    setLoaded(true);
  }, [config, loaded]);
  /** 允许编辑中的暂时空值留在当前控件，但只把能通过 schema 的完整选择持久化。 */
  function update(next: ModelChoice) {
    setChoice(next);
    // 编辑中的空模型名不持久化，避免下次打开恢复一个不可用选择。
    if (modelChoiceSchema.safeParse(next).success)
      localStorage.setItem('bpm-assistant-model', JSON.stringify(next));
  }
  return { choice, update, config };
}
/**
 * 展示 provider 与可手输的 datalist。选择 provider 后清空旧名称，避免误用另一服务的模型 ID。
 * required=false 用于路线/纯规则检测：它们不调用模型，因此不应被空模型名阻止。
 * disabled 作用于整个 fieldset，在请求期间保持当前模型选择稳定。
 */
export function ModelPicker({
  choice,
  onChange,
  disabled = false,
  required = true,
}: {
  choice: ModelChoice;
  onChange: (choice: ModelChoice) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  // 同一页可能有多个助手实例，useId 保证 input/datalist 关联不会串到别的模型选择器。
  const id = useId();
  // 切换 provider 后 useRemote 会取消旧发现请求，防止迟到的 Ollama 列表覆盖 OpenAI 列表。
  const { data, loading, reload } = useRemote<{ models: string[]; warning: string }>(
    `/assistant/models/${choice.provider}`,
  );
  return (
    <fieldset className="model-picker" disabled={disabled}>
      <legend>模型设置</legend>
      <div className="assistant-control-row">
        <label className="field">
          <span>模型服务</span>
          <select
            name="modelProvider"
            value={choice.provider}
            onChange={(e) =>
              onChange({ provider: e.target.value as ModelChoice['provider'], model: '' })
            }
          >
            <option value="ollama">本地 Ollama</option>
            <option value="openai">OpenAI / 兼容接口</option>
          </select>
        </label>
        <label className="field">
          <span>模型名称{required ? ' *' : '（此功能无需模型）'}</span>
          <input
            name="modelName"
            list={id}
            required={required}
            maxLength={150}
            value={choice.model}
            autoCapitalize="none"
            spellCheck={false}
            placeholder="选择或手动输入模型名"
            onChange={(e) => onChange({ ...choice, model: e.target.value })}
          />
          <datalist id={id}>
            {data?.models.map((name) => (
              <option value={name} key={name} />
            ))}
          </datalist>
        </label>
        <button type="button" className="text-button" onClick={reload}>
          刷新列表
        </button>
      </div>
      <small>
        {loading
          ? '正在读取模型列表…'
          : data?.warning || '地址与密钥由服务端 .env 配置；选择会保存在本机。'}
      </small>
    </fieldset>
  );
}
