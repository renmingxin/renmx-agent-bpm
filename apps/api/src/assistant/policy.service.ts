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

interface Chunk {
  id: string;
  index: number;
  text: string;
  vector?: number[];
}
interface StoredPolicy extends PolicyDocument {
  content: string;
  parts: Chunk[];
}

// 中文不依赖英文分词器；关键词检索本身也是 RAG 的一种 retrieval 实现。
export function terms(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || [];
  const han = (normalized.match(/[\u4e00-\u9fff]{2,}/g) || []).flatMap((s) =>
    [...s].slice(0, -1).map((c, i) => c + s[i + 1]),
  );
  return new Set([...words, ...han]);
}
export function cosine(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length || [...a, ...b].some((v) => !Number.isFinite(v))) return 0;
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
  return norm ? dot / norm : 0;
}

@Injectable()
export class PolicyService {
  private ready?: Promise<unknown>;
  constructor(
    @Inject(Store) private readonly store: Store,
    @Inject(ModelGateway) private readonly model: ModelGateway,
  ) {}
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
        client.release();
      }
    })().catch((error) => {
      this.ready = undefined;
      throw error;
    }));
  }
  async list(): Promise<PolicyDocument[]> {
    await this.initialize();
    const result = await this.store.pool.query<{ document: StoredPolicy }>(
      "SELECT document FROM assistant_policies ORDER BY document->>'createdAt' DESC",
    );
    return result.rows.map(
      ({ document: { content: _content, parts: _parts, ...summary } }) => summary,
    );
  }
  async setEnabled(id: string, enabled: boolean) {
    await this.initialize();
    const result = await this.store.pool.query(
      "UPDATE assistant_policies SET document=jsonb_set(document, '{enabled}', $2::jsonb) WHERE id=$1 RETURNING id",
      [id, JSON.stringify(enabled)],
    );
    if (!result.rowCount) throw new NotFoundException('制度不存在');
    return { id, enabled };
  }
  private async extract(input: PolicyInput) {
    if (!input.file) return input.content?.trim() || '';
    const bytes = Buffer.from(input.file.base64, 'base64');
    if (!bytes.length || bytes.length > 4 * 1024 * 1024)
      throw new BadRequestException('文档大小必须在 1 字节到 4MB 之间');
    const ext = extname(input.file.name).toLowerCase();
    try {
      if (ext === '.txt' || ext === '.md') return bytes.toString('utf8');
      if (ext === '.docx') {
        const mammoth = await import('mammoth');
        return (await mammoth.extractRawText({ buffer: bytes })).value;
      }
      if (ext === '.pdf') {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(bytes) });
        try {
          return (await parser.getText()).text;
        } finally {
          await parser.destroy();
        }
      }
    } catch {
      throw new BadRequestException('无法解析文档。请检查文件是否损坏、加密或不是对应格式');
    }
    throw new BadRequestException('支持 UTF-8 TXT、Markdown、文本 PDF 和 DOCX；扫描件请先 OCR');
  }
  async import(input: PolicyInput, actor: string): Promise<PolicyDocument> {
    await this.initialize();
    const content = (await this.extract(input)).replace(/\r\n/g, '\n').trim();
    if (content.length < 20 || content.length > 120000)
      throw new BadRequestException('制度正文需为 20～120000 字符；扫描 PDF 请先 OCR');
    const splitter = new RecursiveCharacterTextSplitter({
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
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('同标题、分类与版本的制度已存在，请使用新版本号');
      throw error;
    }
    const { content: _content, parts: _parts, ...summary } = doc;
    return summary;
  }
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
          const lexical = queryTerms.size ? overlap / queryTerms.size : 0;
          const semantic =
            vector && part.vector && doc.retrieval === profile
              ? Math.max(0, cosine(vector, part.vector))
              : 0;
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
  async saveReport(actor: string, result: import('@bpm/core').AssistantResult) {
    await this.initialize();
    await this.store.pool.query(
      'INSERT INTO assistant_reports(id,actor,input_hash,result) VALUES($1,$2,$3,$4::jsonb)',
      [result.id, actor, result.inputHash, JSON.stringify(result)],
    );
  }
}
