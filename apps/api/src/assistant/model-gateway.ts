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
  /**
   * GET /assistant/config 使用的公开配置摘要，不包含 API Key。
   * configured 只检查配置条件，不代表已完成健康探测；对话模型与向量模型分别配置。
   */
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
  /** 只决定未显式选择模型时的缺省名称；此方法不会下载 Ollama 模型。 */
  defaultModel(provider: ModelChoice['provider']) {
    return provider === 'ollama'
      ? process.env.OLLAMA_MODEL || 'qwen3.5:2b'
      : process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }
  /** 连接地址只来自服务端环境；去掉末尾斜杠，避免拼接 /models 等路径时出现双斜杠。 */
  baseUrl(provider: ModelChoice['provider']) {
    return (
      provider === 'ollama'
        ? process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
        : process.env.OPENAI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/plan/v3'
    ).replace(/\/$/, '');
  }
  /**
   * 查询 provider 已部署模型，最多等待 5 秒。
   * 部分 OpenAI 兼容服务未实现模型发现，失败时返回缺省名称与 warning，界面仍可手动输入。
   */
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
        // Ollama /api/tags 与 OpenAI /models 的外层字段不同，在这里统一成字符串数组。
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
  /**
   * 执行一次受时限控制的对话调用，返回“已解析但尚未做业务核验”的 JSON。
   *
   * @param choice 浏览器选择的 provider/model，不包含地址或密钥。
   * @param system 当前功能专用的系统指令。
   * @param context 已由服务端授权、裁剪的上下文；填单含 userText/schema，制度问答含来源片段。
   * @param signal LangGraph 整体预算传下来的取消信号，防止一个模型调用超出整条链路的时限。
   * @returns unknown 刻意不直接声明 AssistantResult，避免把模型输出误当成可信业务对象。
   */
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
            // 原生约束解码限定 JSON 结构；填单依据进一步限定为用户原文中的实际片段。
            format: z.toJSONSchema(decodingSchema(context)),
            // 结果接口只需要结构化业务内容，不采集或展示模型思考过程。
            think: false,
          })
        : new ChatOpenAI({
            model: choice.model,
            apiKey: process.env.OPENAI_API_KEY,
            configuration: { baseURL: this.baseUrl('openai') },
            useResponsesApi: false,
            // 兼容端点走 Chat Completions；不假定所有服务都支持供应商专用的 Schema 参数。
            maxRetries: 0,
            timeout: 60000,
            maxTokens: 2400,
          });
    try {
      // 把指令与待处理数据分成两条消息，context 中的用户文本不能提升为系统指令。
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
  /**
   * 索引身份由 provider + 服务地址 + 向量模型名组成。
   * 查询时只复用同一 profile 的向量，避免同名模型来自不同服务时混用向量空间。
   */
  embeddingProfile() {
    const cfg = this.config().embedding;
    // 地址也是索引身份的一部分，避免两个服务上同名但不同向量空间的模型混用。
    return cfg.provider === 'keyword'
      ? 'keyword'
      : `${cfg.provider}:${this.baseUrl(cfg.provider)}:${cfg.model}`;
  }
  /** 根据全局检索配置创建向量客户端；keyword 模式返回 null，完全不请求 Embedding。 */
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
            // 保留 SDK 自己的信号，同时给每次底层 HTTP 请求增加时限。
            AbortSignal.timeout(60000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    });
  }
  /** 文档导入时批量生成片段向量；返回 null 表示只建立关键词索引，不是生成失败。 */
  async embedDocuments(texts: string[]) {
    const client = this.embeddings();
    if (!client) return null;
    return client.embedDocuments(texts);
  }
  /** 查询时只生成一个问题向量，模型配置必须与目标文档 profile 相符才能做余弦比较。 */
  async embedQuery(text: string) {
    const client = this.embeddings();
    if (!client) return null;
    return client.embedQuery(text);
  }
}
