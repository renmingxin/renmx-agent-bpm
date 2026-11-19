/**
 * 模型边界：用 LangChain 统一 Ollama / OpenAI 兼容 Chat Completions。
 * 地址与密钥只由服务端环境配置；浏览器可以自由选 provider/model，不能提交任意 URL。
 * 固定 JSON 提示 + Zod 后验校验兼容不支持工具调用的小模型，不假定所有模型支持 JSON Schema。
 */
import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z, type AssistantConfig, type ModelChoice } from '@bpm/core';
import { decodingSchema } from './output-schema';

@Injectable()
export class ModelGateway {
  config(): AssistantConfig {
    const provider = process.env.ASSISTANT_PROVIDER === 'openai' ? 'openai' : 'ollama';
    const embedding = process.env.ASSISTANT_EMBEDDING_PROVIDER;
    return {
      defaultModel: { provider, model: this.defaultModel(provider) },
      providers: [
        { id: 'ollama', label: '本地 Ollama', baseUrl: this.baseUrl('ollama'), configured: true },
        {
          id: 'openai',
          label: 'OpenAI / 兼容接口',
          baseUrl: this.baseUrl('openai'),
          configured: Boolean(process.env.OPENAI_API_KEY),
        },
      ],
      embedding: {
        provider: embedding === 'ollama' || embedding === 'openai' ? embedding : 'keyword',
        model:
          embedding === 'openai'
            ? process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
            : embedding === 'ollama'
              ? process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text'
              : '',
      },
    };
  }
  defaultModel(provider: ModelChoice['provider']) {
    return provider === 'ollama'
      ? process.env.OLLAMA_MODEL || 'qwen3.5:2b'
      : process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }
  baseUrl(provider: ModelChoice['provider']) {
    return (
      provider === 'ollama'
        ? process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
        : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    ).replace(/\/$/, '');
  }
  async listModels(provider: ModelChoice['provider']) {
    if (provider === 'openai' && !process.env.OPENAI_API_KEY)
      return {
        models: [this.defaultModel(provider)],
        warning: '请先在服务端 .env 配置 OPENAI_API_KEY（无鉴权的兼容服务可填 local）',
      };
    try {
      const response = await fetch(
        `${this.baseUrl(provider)}${provider === 'ollama' ? '/api/tags' : '/models'}`,
        {
          signal: AbortSignal.timeout(5000),
          headers:
            provider === 'openai' ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {},
        },
      );
      if (!response.ok) throw new Error('discovery failed');
      const data = (await response.json()) as {
        models?: { name: string }[];
        data?: { id: string }[];
      };
      return {
        models:
          provider === 'ollama'
            ? (data.models || []).map((m) => m.name)
            : (data.data || []).map((m) => m.id),
        warning: '',
      };
    } catch {
      // 部分兼容服务没有 /models，但可以正常聊天；保留手动输入能力。
      return {
        models: [this.defaultModel(provider)],
        warning: '未能读取模型列表，可手动填写已部署的模型名；请检查服务地址',
      };
    }
  }
  async generate(
    choice: ModelChoice,
    system: string,
    context: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (choice.provider === 'openai' && !process.env.OPENAI_API_KEY)
      throw new BadRequestException(
        '请在根 .env 配置 OPENAI_API_KEY 后重启 API；兼容无鉴权服务可填 local',
      );
    const model =
      choice.provider === 'ollama'
        ? new ChatOllama({
            model: choice.model,
            baseUrl: this.baseUrl('ollama'),
            temperature: 0,
            maxRetries: 0,
            numPredict: 2400,
            format: z.toJSONSchema(decodingSchema(context)),
            think: false,
          })
        : new ChatOpenAI({
            model: choice.model,
            apiKey: process.env.OPENAI_API_KEY,
            configuration: { baseURL: this.baseUrl('openai') },
            useResponsesApi: false,
            maxRetries: 0,
            timeout: 60000,
            maxTokens: 2400,
          });
    try {
      const message = await model.invoke(
        [new SystemMessage(system), new HumanMessage(JSON.stringify(context))],
        { signal },
      );
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((p) => p.type === 'text')
              .map((p) => ('text' in p ? p.text : ''))
              .join('');
      // 只接受完整 JSON 或单一 JSON 代码块；不把自由文本片段偷偷当成有效结果。
      const clean = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      return JSON.parse(clean);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadGatewayException(
        '模型未返回有效 JSON 或调用失败。请检查模型名、服务连接及 JSON 生成能力，再重试',
      );
    }
  }
  embeddingProfile() {
    const cfg = this.config().embedding;
    // 地址也是索引身份的一部分，避免两个服务上同名但不同向量空间的模型混用。
    return cfg.provider === 'keyword'
      ? 'keyword'
      : `${cfg.provider}:${this.baseUrl(cfg.provider)}:${cfg.model}`;
  }
  private embeddings() {
    const cfg = this.config().embedding;
    if (cfg.provider === 'keyword') return null;
    if (cfg.provider === 'openai') {
      if (!process.env.OPENAI_API_KEY)
        throw new BadRequestException('OpenAI Embedding 需要服务端 API Key');
      return new OpenAIEmbeddings({
        model: cfg.model,
        apiKey: process.env.OPENAI_API_KEY,
        configuration: { baseURL: this.baseUrl('openai') },
        maxRetries: 0,
        timeout: 60000,
      });
    }
    return new OllamaEmbeddings({
      maxRetries: 0,
      model: cfg.model,
      baseUrl: this.baseUrl('ollama'),
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(60000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    });
  }
  async embedDocuments(texts: string[]) {
    const client = this.embeddings();
    if (!client) return null;
    return client.embedDocuments(texts);
  }
  async embedQuery(text: string) {
    const client = this.embeddings();
    if (!client) return null;
    return client.embedQuery(text);
  }
}
