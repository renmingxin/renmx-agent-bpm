/**
 * 制度 RAG：提取文档 → 切分 → 可选 Embedding → PostgreSQL 持久化 → 检索。
 * 默认中文二元词检索无需额外模型；配置向量后混合召回，JSONB 向量只适合小规模教学库。
 * 文档版本不可原地改正文；停用可恢复，检索前按分类、生效日期及版本过滤。
 */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { PolicyDocument, PolicyInput, PolicySource } from '@bpm/core';
import { Store } from '../store';
import { ModelGateway } from './model-gateway';

/** 存储层片段。与返回给前端的 PolicySource 不同，这里可能包含向量，且 index 从 0 开始。 */
interface Chunk {
  /** 文档 ID + 切分序号组成的稳定片段标识。 */
  id: string;
  /** 内部数组序号；给用户展示时转换为 index + 1。 */
  index: number;
  /** 解析器提取并经过切分的真实正文。 */
  text: string;
  /** keyword 模式下不存在；有值时必须属于文档记录的 retrieval profile。 */
  vector?: number[];
}
/** 数据库存储完整文档，而列表 API 只返回它继承的 PolicyDocument 元信息。 */
interface StoredPolicy extends PolicyDocument {
  /** 保存原始提取正文，方便保留制度版本的内容。 */
  content: string;
  /** 带有序号、正文与可选向量的片段集合。 */
  parts: Chunk[];
}

/**
 * 把查询/片段转换为去重词项：英文数字单词、单个汉字、相邻两个汉字。
 * 中文二元词可以表达“报销”“票据”等组合，避免仅按单字检索导致过多偶然命中。
 * 这只是轻量教学检索，不是完整中文分词器或语义理解模型。
 */
export function terms(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || [];
  const han = (normalized.match(/[\u4e00-\u9fff]{2,}/g) || []).flatMap((s) =>
    [...s].slice(0, -1).map((c, i) => c + s[i + 1]),
  );
  // 使用集合，重复出现的同一个词不会无限抬高后续的重合分数。
  return new Set([...words, ...han]);
}
/**
 * 计算向量余弦：点积 / 两个向量的模长乘积。
 * 空向量、维度不一致、非有限数字和零向量返回 0，避免产生 NaN 影响排序。
 * 返回的是相似度，不是“制度适用概率”；profile 是否相同由调用方另行核对。
 */
export function cosine(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length || [...a, ...b].some((v) => !Number.isFinite(v))) return 0;
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
  return norm ? dot / norm : 0;
}

@Injectable()
export class PolicyService {
  /** 缓存初始化 Promise，同一实例的并发请求等待同一次建表操作。 */
  private ready?: Promise<unknown>;
  constructor(
    @Inject(Store) private readonly store: Store,
    @Inject(ModelGateway) private readonly model: ModelGateway,
  ) {}
  /**
   * 懒初始化两张 AI 表，原 BPM 表不受影响。
   * 整个事务使用同一个 PoolClient；advisory 锁让多个 API 进程的建表动作串行。
   */
  initialize() {
    // 独立迁移不改变原 BPM 表；多个 API 同时启动时锁定同一个迁移编号。
    return (this.ready ??= (async () => {
      const client = await this.store.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(74001802)');
        await client.query(`CREATE TABLE IF NOT EXISTS assistant_policies (
        id TEXT PRIMARY KEY, document JSONB NOT NULL,
        created_order BIGINT GENERATED ALWAYS AS IDENTITY
      ); CREATE UNIQUE INDEX IF NOT EXISTS assistant_policy_version ON assistant_policies
      ((document->>'title'), (document->>'category'), (document->>'version'));
      CREATE TABLE IF NOT EXISTS assistant_reports (
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, input_hash TEXT NOT NULL,
        result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        // 无论成功或失败都归还连接，否则反复导入/查询会耗尽连接池。
        client.release();
      }
    })().catch((error) => {
      // 失败的 Promise 不永久缓存，数据库恢复后下一次请求可以重新初始化。
      this.ready = undefined;
      throw error;
    }));
  }
  /** 返回制度管理列表，主动剔除 content/parts，避免把全文与向量装入 HTTP 响应。 */
  async list(): Promise<PolicyDocument[]> {
    await this.initialize();
    const result = await this.store.pool.query<{ document: StoredPolicy }>(
      "SELECT document FROM assistant_policies ORDER BY document->>'createdAt' DESC",
    );
    return result.rows.map(
      ({ document: { content: _content, parts: _parts, ...summary } }) => summary,
    );
  }
  /** 可恢复地启停一个具体制度版本；不存在的 ID 返回 404，不能误报操作成功。 */
  async setEnabled(id: string, enabled: boolean) {
    await this.initialize();
    const result = await this.store.pool.query(
      "UPDATE assistant_policies SET document=jsonb_set(document, '{enabled}', $2::jsonb) WHERE id=$1 RETURNING id",
      [id, JSON.stringify(enabled)],
    );
    if (!result.rowCount) throw new NotFoundException('制度不存在');
    return { id, enabled };
  }
  /**
   * 将上传结构转成纯文本。只支持明确列出的解析器，不执行文档内脚本或宏。
   * file 存在时优先于 content；4MB 限制作用于 Base64 解码后的字节，而不是编码字符串。
   */
  private async extract(input: PolicyInput) {
    if (!input.file) return input.content?.trim() || '';
    const bytes = Buffer.from(input.file.base64, 'base64');
    if (!bytes.length || bytes.length > 4 * 1024 * 1024)
      throw new BadRequestException('文档大小必须在 1 字节到 4MB 之间');
    const ext = extname(input.file.name).toLowerCase();
    try {
      if (ext === '.txt' || ext === '.md') return bytes.toString('utf8');
      if (ext === '.docx') {
        // 延迟加载文档库，普通审批/路线解释不需要初始化 Word/PDF 解析器。
        const mammoth = await import('mammoth');
        return (await mammoth.extractRawText({ buffer: bytes })).value;
      }
      if (ext === '.pdf') {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(bytes) });
        try {
          return (await parser.getText()).text;
        } finally {
          // PDF 解析器可能持有工作线程等资源，成功和失败都必须销毁。
          await parser.destroy();
        }
      }
    } catch {
      throw new BadRequestException('无法解析文档。请检查文件是否损坏、加密或不是对应格式');
    }
    throw new BadRequestException('支持 UTF-8 TXT、Markdown、文本 PDF 和 DOCX；扫描件请先 OCR');
  }
  /**
   * 导入链路：提取正文 → 长度校验 → 带重叠切分 → 可选向量 → 保存一个新版本。
   * 解析或向量化失败时不会落库半成品；同标题/分类/版本由数据库唯一索引防止并发重复。
   */
  async import(input: PolicyInput, actor: string): Promise<PolicyDocument> {
    await this.initialize();
    const content = (await this.extract(input)).replace(/\r\n/g, '\n').trim();
    if (content.length < 20 || content.length > 120000)
      throw new BadRequestException('制度正文需为 20～120000 字符；扫描 PDF 请先 OCR');
    const splitter = new RecursiveCharacterTextSplitter({
      // 重叠部分保留段落边界的上下文；中文标点排在空格前，最后才退回按字符切分。
      chunkSize: 800,
      chunkOverlap: 120,
      separators: ['\n\n', '\n', '。', '；', ' ', ''],
    });
    const texts = await splitter.splitText(content);
    if (texts.length > 200) throw new BadRequestException('单份制度最多 200 个片段，请拆分文档');
    let vectors: number[][] | null;
    try {
      vectors = await this.model.embedDocuments(texts);
    } catch {
      throw new BadGatewayException(
        '制度未导入：Embedding 失败，请检查向量模型。可切换 keyword 模式后重新导入',
      );
    }
    // null 是合法的关键词模式；非 null 时必须与片段一一对应，且每个向量都有效。
    if (
      vectors &&
      (vectors.length !== texts.length ||
        vectors.some((v) => !v.length || v.some((n) => !Number.isFinite(n))))
    )
      throw new BadGatewayException('Embedding 返回无效向量，制度未导入');
    const id = `policy_${randomUUID().slice(0, 16)}`;
    const doc: StoredPolicy = {
      id,
      title: input.title,
      version: input.version,
      category: input.category,
      effectiveFrom: input.effectiveFrom,
      ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : {}),
      enabled: true,
      createdAt: new Date().toISOString(),
      createdBy: actor,
      chunks: texts.length,
      retrieval: this.model.embeddingProfile(),
      content,
      parts: texts.map((text, index) => ({
        id: `${id}_${index}`,
        index,
        text,
        ...(vectors ? { vector: vectors[index] } : {}),
      })),
    };
    try {
      await this.store.pool.query(
        'INSERT INTO assistant_policies(id,document) VALUES($1,$2::jsonb)',
        [id, JSON.stringify(doc)],
      );
    } catch (error) {
      // 23505 是 PostgreSQL 唯一约束冲突。转成可理解的 409，而不是泄露内部 SQL 错误。
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('同标题、分类与版本的制度已存在，请使用新版本号');
      throw error;
    }
    const { content: _content, parts: _parts, ...summary } = doc;
    return summary;
  }
  /**
   * 按业务类别和适用日检索，返回排序后的最多四段真实来源。
   * 先做适用性/版本过滤，再算相关性，避免已失效制度因为“语义相近”重新混入结果。
   * 当前在 Node 中扫描 JSONB 向量，适合小型教学库；大库应改为数据库索引召回。
   */
  async search(
    query: string,
    category: PolicyInput['category'],
    at: string,
  ): Promise<PolicySource[]> {
    await this.initialize();
    const result = await this.store.pool.query<{ document: StoredPolicy }>(
      `SELECT document FROM assistant_policies
      WHERE document->>'enabled'='true' AND (document->>'category'='all' OR document->>'category'=$1 OR $1='all')
      AND document->>'effectiveFrom' <= $2 AND (document->>'effectiveTo' IS NULL OR document->>'effectiveTo' >= $2)`,
      [category, at],
    );
    // 先按适用性过滤，再在同标题/分类内挑最高启用版本，避免旧制度混入同一回答。
    const versions = new Map<string, StoredPolicy>();
    for (const { document: doc } of result.rows) {
      const key = `${doc.category}:${doc.title}`;
      if (!versions.has(key) || versions.get(key)!.version < doc.version) versions.set(key, doc);
    }
    const queryTerms = terms(query);
    let vector: number[] | null = null;
    try {
      vector = await this.model.embedQuery(query);
    } catch {
      throw new BadGatewayException('制度查询的 Embedding 调用失败，请检查向量模型配置');
    }
    const profile = this.model.embeddingProfile();
    return [...versions.values()]
      .flatMap((doc) =>
        doc.parts.map((part) => {
          const tokens = terms(`${doc.title} ${part.text}`);
          const overlap = [...queryTerms].filter((t) => tokens.has(t)).length;
          // 关键词覆盖率以查询词项为分母；同一词多次出现不重复计分。
          const lexical = queryTerms.size ? overlap / queryTerms.size : 0;
          const semantic =
            vector && part.vector && doc.retrieval === profile
              ? Math.max(0, cosine(vector, part.vector))
              : 0;
          // 取关键词分数与混合分数的较高者，旧文档缺向量/配置不匹配时仍能走关键词召回。
          const score = Math.max(lexical, semantic * 0.8 + lexical * 0.2);
          return {
            id: part.id,
            documentId: doc.id,
            title: doc.title,
            version: doc.version,
            chunk: part.index + 1,
            text: part.text,
            score,
          };
        }),
      )
      .filter((s) => s.score >= (vector ? 0.3 : 0.06))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }
  /** 保存经过授权、结构、引用及版本核验的成功报告；它不是审批事件，不修改 Task 状态。 */
  async saveReport(actor: string, result: import('@bpm/core').AssistantResult) {
    await this.initialize();
    await this.store.pool.query(
      'INSERT INTO assistant_reports(id,actor,input_hash,result) VALUES($1,$2,$3,$4::jsonb)',
      [result.id, actor, result.inputHash, JSON.stringify(result)],
    );
  }
}
