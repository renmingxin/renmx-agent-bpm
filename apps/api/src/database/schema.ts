/**
 * 初始迁移：JSONB 容纳可变的流程定义和运行快照。
 * 生成列将 JSON 关联字段提取成可建立索引/外键的关系字段。
 * “一个实例最多一个 pending 待办”同时由业务事务与唯一索引保证。
 * 后续结构变更应编写编号迁移；IF NOT EXISTS 不会修改已有列。
 */
export const INITIAL_SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS bpm_serial_seq;
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_order BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  workflow_id TEXT GENERATED ALWAYS AS (document->>'workflowId') STORED NOT NULL REFERENCES workflows(id),
  serial TEXT GENERATED ALWAYS AS (document->>'serial') STORED NOT NULL UNIQUE,
  created_order BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  instance_id TEXT GENERATED ALWAYS AS (document->>'instanceId') STORED NOT NULL REFERENCES instances(id),
  status TEXT GENERATED ALWAYS AS (document->>'status') STORED NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_order BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_task_per_instance ON tasks(instance_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS tasks_instance_id ON tasks(instance_id);
CREATE INDEX IF NOT EXISTS instances_workflow_id ON instances(workflow_id);
`;
