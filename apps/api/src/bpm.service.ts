/**
 * 应用服务把纯引擎计算转化为持久化业务操作。
 * 设计态保存可变草稿，发布时复制为不可变版本；运行态始终使用实例快照。
 * 写操作全部在事务内执行，task/instance 行锁保证重复点击不会推进两次。
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  advance,
  createTemplate,
  users,
  validateDefinition,
  validateForm,
  type AuditEvent,
  type Definition,
  type FormData,
  type Instance,
  type Workflow,
} from '@bpm/core';
import { randomUUID } from 'node:crypto';
import { Repository, Store } from './store';
import { seedDemo } from './seed';

const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

@Injectable()
export class BpmService implements OnModuleInit {
  constructor(@Inject(Store) private readonly store: Store) {}
  async onModuleInit() {
    await this.store.initialize();
    if (process.env.BPM_SEED !== 'false') await seedDemo(this, this.store);
  }

  async dashboard() {
    // 单条查询具有一致快照，不会读到“任务已完成但实例还未更新”的中间态。
    const result = await this.store.pool.query(`
      SELECT COALESCE((SELECT jsonb_agg(document ORDER BY created_order DESC) FROM workflows), '[]'::jsonb) AS workflows,
      COALESCE((SELECT jsonb_agg(document ORDER BY created_order DESC) FROM instances), '[]'::jsonb) AS instances,
      COALESCE((SELECT jsonb_agg(document ORDER BY created_order DESC) FROM tasks), '[]'::jsonb) AS tasks
    `);
    return { ...result.rows[0], users };
  }
  async workflow(id: string, tx: Repository = this.store, lock = false): Promise<Workflow> {
    const wf = await tx.get('workflows', id, lock);
    if (!wf) throw new NotFoundException('流程不存在');
    return wf;
  }
  async instance(id: string) {
    const result = await this.store.pool.query(
      `
      SELECT i.document AS instance, COALESCE((SELECT jsonb_agg(t.document ORDER BY t.created_order) FROM tasks t WHERE t.instance_id=i.id), '[]'::jsonb) AS tasks
      FROM instances i WHERE i.id=$1`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException('申请不存在');
    return result.rows[0];
  }
  async create(name: string, template: 'expense' | 'leave' | 'purchase' | 'blank') {
    const at = now();
    const wf: Workflow = {
      id: uid('wf'),
      draft: createTemplate(template, name),
      versions: [],
      enabled: false,
      revision: 1,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.put('workflows', wf);
    return wf;
  }
  async save(id: string, revision: number, definition: Definition) {
    return this.store.transaction(async (tx) => {
      const wf = await this.workflow(id, tx, true);
      this.checkRevision(wf, revision);
      wf.draft = definition;
      wf.revision++;
      wf.updatedAt = now();
      await tx.put('workflows', wf);
      return wf;
    });
  }
  async publish(id: string, revision: number) {
    return this.store.transaction(async (tx) => {
      const wf = await this.workflow(id, tx, true);
      this.checkRevision(wf, revision);
      const errors = validateDefinition(wf.draft);
      if (errors.length) throw new BadRequestException(errors.join('；'));
      wf.versions.push({
        version: wf.versions.length + 1,
        definition: structuredClone(wf.draft),
        publishedAt: now(),
      });
      wf.enabled = true;
      wf.revision++;
      wf.updatedAt = now();
      await tx.put('workflows', wf);
      return wf;
    });
  }
  async setEnabled(id: string, revision: number, enabled: boolean) {
    return this.store.transaction(async (tx) => {
      const wf = await this.workflow(id, tx, true);
      this.checkRevision(wf, revision);
      if (enabled && !wf.versions.length) throw new BadRequestException('请先发布流程');
      wf.enabled = enabled;
      wf.revision++;
      wf.updatedAt = now();
      await tx.put('workflows', wf);
      return wf;
    });
  }
  async start(workflowId: string, actor: string, title: string, raw: FormData) {
    return this.store.transaction(async (tx) => {
      // 与发布/启停锁定同一流程行，确保一次发起只读取一个确定的已发布版本。
      const wf = await this.workflow(workflowId, tx, true);
      const published = wf.versions.at(-1);
      if (!wf.enabled || !published) throw new BadRequestException('流程尚未发布或已停用');
      const definition = structuredClone(published.definition);
      const data = this.cleanForm(definition, raw);
      const start = definition.nodes.find((n) => n.data.kind === 'start')!;
      const at = now();
      const instance: Instance = {
        id: uid('ins'),
        serial: await tx.nextSerial(),
        workflowId,
        version: published.version,
        definition,
        title,
        applicant: actor,
        data,
        status: 'running',
        currentNodeId: start.id,
        createdAt: at,
        updatedAt: at,
        history: [],
      };
      this.audit(instance, start.id, start.data.label, 'start', actor, '提交申请');
      // 先写实例满足任务表外键；整个事务提交前，其他请求看不到这些中间状态。
      await tx.put('instances', instance);
      await this.move(tx, instance, start.id);
      await tx.put('instances', instance);
      return instance;
    });
  }
  async act(
    taskId: string,
    actor: string,
    action: 'approve' | 'reject',
    comment: string,
    raw?: FormData,
  ) {
    return this.store.transaction(async (tx) => {
      // 后来的重复请求在行锁处等待，拿到锁后读到的会是已处理状态。
      const task = await tx.get('tasks', taskId, true);
      if (!task) throw new NotFoundException('待办不存在');
      if (task.assignee !== actor) throw new ForbiddenException('只有当前审批人可以处理此待办');
      if (task.status !== 'pending') throw new ConflictException('此待办已经处理，请刷新页面');
      const instance = await tx.get('instances', task.instanceId, true);
      if (!instance) throw new NotFoundException('申请不存在');
      if (instance.status !== 'running' || instance.currentNodeId !== task.nodeId)
        throw new ConflictException('流程状态已改变，请刷新页面');
      const node = instance.definition.nodes.find((n) => n.id === task.nodeId)!;
      if (node.data.assignee !== actor) throw new ForbiddenException('审批人与当前节点不匹配');
      if (action === 'reject' && !comment.trim()) throw new BadRequestException('请填写驳回原因');
      const before = instance.data;
      if (action === 'approve')
        instance.data = this.cleanForm(instance.definition, raw ?? instance.data);
      const changes = Object.fromEntries(
        Object.entries(instance.data).filter(([key, value]) => before[key] !== value),
      );
      this.audit(
        instance,
        node.id,
        node.data.label,
        action,
        actor,
        comment || '同意',
        Object.keys(changes).length ? changes : undefined,
      );
      task.status = action === 'approve' ? 'approved' : 'rejected';
      task.completedAt = now();
      // 先完成旧任务，再创建新任务，遵守每个实例最多一个 pending 的数据库约束。
      await tx.put('tasks', task);
      if (action === 'reject') instance.status = 'rejected';
      else await this.move(tx, instance, node.id);
      instance.updatedAt = now();
      await tx.put('instances', instance);
      return instance;
    });
  }
  private checkRevision(wf: Workflow, revision: number) {
    if (wf.revision !== revision)
      throw new ConflictException('流程已被其他页面修改，请刷新后再操作');
  }
  private cleanForm(def: Definition, raw: FormData) {
    try {
      return validateForm(def.fields, raw);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
  private audit(
    instance: Instance,
    nodeId: string,
    label: string,
    action: AuditEvent['action'],
    actor: string,
    comment: string,
    changes?: FormData,
  ) {
    instance.history.push({
      id: uid('evt'),
      nodeId,
      label,
      action,
      actor,
      comment,
      at: now(),
      ...(changes ? { changes } : {}),
    });
  }
  private async move(tx: Repository, instance: Instance, from: string) {
    // 引擎返回路线；应用服务负责把路线落实为审批记录、任务和实例状态。
    const { transitions, next } = advance(instance.definition, from, instance.data);
    for (const t of transitions)
      this.audit(instance, t.node.id, t.node.data.label, 'condition', 'system', t.detail);
    instance.currentNodeId = next.id;
    if (next.data.kind === 'end') {
      instance.status = 'completed';
      this.audit(instance, next.id, next.data.label, 'complete', 'system', '所有审批已完成');
    } else
      await tx.put('tasks', {
        id: uid('task'),
        instanceId: instance.id,
        nodeId: next.id,
        assignee: next.data.assignee!,
        status: 'pending',
        createdAt: now(),
      });
  }
}
