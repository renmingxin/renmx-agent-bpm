/**
 * PostgreSQL 仓储：Repository 封装查询，Store 管理连接池和事务。
 * 一个事务的所有语句必须使用同一个 PoolClient；transaction 把绑定连接的
 * Repository 传入业务回调，避免业务代码意外使用连接池破坏事务原子性。
 */
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import type { Instance, Task, Workflow } from '@bpm/core';
import { INITIAL_SCHEMA } from './database/schema';

type Tables = { workflows: Workflow; instances: Instance; tasks: Task };
export const DEFAULT_DATABASE_URL = 'postgresql://bpm:bpm_dev_password@127.0.0.1:5440/bpm';

export class Repository {
  constructor(protected readonly connection: Pool | PoolClient) {}
  async all<T extends keyof Tables>(table: T): Promise<Tables[T][]> {
    // 表名来自内部枚举，动态值通过参数传入，不能拼接用户输入。
    const result = await this.connection.query<{ document: Tables[T] }>(
      `SELECT document FROM ${table} ORDER BY created_order DESC`,
    );
    return result.rows.map((row) => row.document);
  }
  async get<T extends keyof Tables>(
    table: T,
    id: string,
    forUpdate = false,
  ): Promise<Tables[T] | undefined> {
    const result = await this.connection.query<{ document: Tables[T] }>(
      `SELECT document FROM ${table} WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return result.rows[0]?.document;
  }
  async put<T extends keyof Tables>(table: T, value: Tables[T]): Promise<void> {
    await this.connection.query(
      `INSERT INTO ${table} (id,document) VALUES ($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET document=excluded.document`,
      [value.id, JSON.stringify(value)],
    );
  }
  async nextSerial(): Promise<string> {
    // sequence 能抵御并发。事务回滚后出现空号属于预期，不能用 COUNT+1 代替。
    const result = await this.connection.query<{ value: string }>(
      "SELECT nextval('bpm_serial_seq') AS value",
    );
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' })
      .format(new Date())
      .replaceAll('-', '');
    return `BPM-${date}-${result.rows[0].value.padStart(4, '0')}`;
  }
  async seedLock(): Promise<void> {
    await this.connection.query('SELECT pg_advisory_xact_lock(74001801)');
  }
  async migrate(): Promise<void> {
    await this.connection.query(INITIAL_SCHEMA);
  }
}

@Injectable()
export class Store extends Repository implements OnModuleDestroy {
  readonly pool: Pool;
  private initialization?: Promise<void>;
  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
    super(pool);
    this.pool = pool;
    pool.on('error', (error) => console.error('PostgreSQL idle connection error:', error.message));
  }
  initialize(): Promise<void> {
    // 初始化承诺只创建一次；跨进程通过 advisory lock 避免同时执行建表。
    return (this.initialization ??= this.transaction(async (tx) => {
      await tx.seedLock();
      await tx.migrate();
    }));
  }
  async transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new Repository(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
