/**
 * PostgreSQL 集成测试：直接使用 Docker 中的 bpm_test 数据库。
 * 每个用例清空的仅是测试库；防护检查会拒绝任何不以 _test 结尾的数据库。
 * 这里验证事务、锁和数据库约束，不能用内存 mock 替代这些行为。
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { BpmService } from '../src/bpm.service';
import { Store } from '../src/store';
import { createApp } from '../src/main';
import type { Instance, Task, Workflow } from '@bpm/core';

function selectTestDatabase() {
  const url =
    process.env.TEST_DATABASE_URL || 'postgresql://bpm:bpm_dev_password@127.0.0.1:5440/bpm_test';
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('测试只能连接名称以 _test 结尾的独立数据库');
  process.env.DATABASE_URL = url;
  process.env.BPM_SEED = 'false';
}
async function resetStore() {
  selectTestDatabase();
  const store = new Store();
  await store.initialize();
  await store.pool.query(
    'TRUNCATE tasks, instances, workflows RESTART IDENTITY CASCADE; ALTER SEQUENCE bpm_serial_seq RESTART WITH 1',
  );
  return store;
}
async function fixture(t: TestContext) {
  const store = await resetStore();
  t.after(() => store.onModuleDestroy());
  const service = new BpmService(store);
  const created = await service.create('测试报销', 'expense');
  const wf = await service.publish(created.id, created.revision);
  return { store, service, wf };
}
const raw = { category: '差旅交通', amount: 4500, date: '2026-11-18', reason: '测试差旅' };

test('serial approvals route through finance and complete with audit history', async (t) => {
  const { service, store, wf } = await fixture(t);
  const instance = await service.start(wf.id, 'u-lin', '报销测试', raw);
  const manager = (await store.all('tasks'))[0];
  assert.equal(manager.assignee, 'u-chen');
  const after = await service.act(manager.id, 'u-chen', 'approve', '同意');
  assert.equal(after.currentNodeId, 'finance');
  const finance = (await store.all('tasks')).find((t) => t.status === 'pending')!;
  const done = await service.act(finance.id, 'u-wang', 'approve', '核对无误');
  assert.equal(done.status, 'completed');
  assert.deepEqual(
    done.history.map((h) => h.action),
    ['start', 'approve', 'condition', 'approve', 'complete'],
  );
  assert.equal(
    (await store.all('tasks')).filter((t) => t.instanceId === instance.id && t.status === 'pending')
      .length,
    0,
  );
});
test('wrong assignee is rejected and concurrent approvals advance exactly once', async (t) => {
  const { service, store, wf } = await fixture(t);
  await service.start(wf.id, 'u-lin', '测试', raw);
  const task = (await store.all('tasks'))[0];
  await assert.rejects(() => service.act(task.id, 'u-lin', 'approve', ''), /只有当前审批人/);
  const attempts = await Promise.allSettled([
    service.act(task.id, 'u-chen', 'approve', ''),
    service.act(task.id, 'u-chen', 'approve', ''),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
  assert.equal((await store.all('tasks')).filter((t) => t.status === 'pending').length, 1);
});
test('rejection is terminal, requires a reason and rolls back invalid actions', async (t) => {
  const { service, store, wf } = await fixture(t);
  await service.start(wf.id, 'u-lin', '测试', raw);
  const task = (await store.all('tasks'))[0];
  await assert.rejects(() => service.act(task.id, 'u-chen', 'reject', ''), /驳回原因/);
  assert.equal((await store.get('tasks', task.id))?.status, 'pending');
  const result = await service.act(task.id, 'u-chen', 'reject', '缺少费用明细');
  assert.equal(result.status, 'rejected');
  assert.equal(result.history.at(-1)?.comment, '缺少费用明细');
  assert.equal((await store.all('tasks')).filter((t) => t.status === 'pending').length, 0);
});
test('edited data is validated and audited before branching', async (t) => {
  const { service, store, wf } = await fixture(t);
  await service.start(wf.id, 'u-lin', '测试', raw);
  const task = (await store.all('tasks'))[0];
  await assert.rejects(
    () => service.act(task.id, 'u-chen', 'approve', '', { ...raw, amount: 'bad' }),
    /有效数字/,
  );
  assert.equal((await store.get('tasks', task.id))?.status, 'pending');
  const result = await service.act(task.id, 'u-chen', 'approve', '核减金额', {
    ...raw,
    amount: 1000,
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.history[1].changes, { amount: 1000 });
});
test('running instances retain their snapshot when the next version changes assignee', async (t) => {
  const { service, wf } = await fixture(t);
  const original = await service.start(wf.id, 'u-lin', 'v1 测试', raw);
  const draft = structuredClone(wf.draft);
  draft.nodes.find((n) => n.id === 'finance')!.data.assignee = 'u-lin';
  const saved = await service.save(wf.id, wf.revision, draft);
  await service.publish(wf.id, saved.revision);
  const next = await service.start(wf.id, 'u-lin', 'v2 测试', raw);
  const previous = (await service.instance(original.id)).instance as Instance;
  assert.equal(previous.version, 1);
  assert.equal(previous.definition.nodes.find((n) => n.id === 'finance')?.data.assignee, 'u-wang');
  assert.equal(next.version, 2);
  assert.equal(next.definition.nodes.find((n) => n.id === 'finance')?.data.assignee, 'u-lin');
});
test('revision prevents lost updates and disabling only blocks new requests', async (t) => {
  const { service, store, wf } = await fixture(t);
  await service.start(wf.id, 'u-lin', '测试', { ...raw, amount: 100 });
  const saved = await service.save(wf.id, wf.revision, wf.draft);
  await assert.rejects(() => service.save(wf.id, wf.revision, wf.draft), /已被其他页面修改/);
  await service.setEnabled(wf.id, saved.revision, false);
  await assert.rejects(() => service.start(wf.id, 'u-lin', '停止后测试', raw), /停用/);
  const task = (await store.all('tasks'))[0];
  assert.equal((await service.act(task.id, 'u-chen', 'approve', '')).status, 'completed');
});
test('PostgreSQL persists data across connection-pool restarts and rejects duplicate pending tasks', async () => {
  const store = await resetStore();
  try {
    const service = new BpmService(store);
    const wf = await service.create('持久化测试', 'expense');
    await service.publish(wf.id, 1);
    const instance = await service.start(wf.id, 'u-lin', '重启测试', raw);
    const task = (await store.all('tasks'))[0];
    await assert.rejects(
      () => store.put('tasks', { ...task, id: 'duplicate-task' }),
      /one_pending_task_per_instance/,
    );
    const other = new Store();
    try {
      assert.equal((await other.get('instances', instance.id))?.title, '重启测试');
    } finally {
      await other.onModuleDestroy();
    }
  } finally {
    await store.onModuleDestroy();
  }
});
test('HTTP validates identities/payloads and exposes concurrent task conflict as 409', async () => {
  const store = await resetStore();
  await store.onModuleDestroy();
  const app = await createApp({ logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const request = (path: string, method = 'GET', body?: unknown, user = 'u-chen') =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await request('/dashboard', 'GET', undefined, 'unknown')).status, 401);
    assert.equal((await request('/workflows', 'POST', { name: '' })).status, 400);
    const wf = (await (
      await request('/workflows', 'POST', { name: 'HTTP 测试', template: 'expense' })
    ).json()) as Workflow;
    assert.equal(
      (await request(`/workflows/${wf.id}/publish`, 'POST', { revision: 1 })).status,
      201,
    );
    assert.equal(
      (await request(`/workflows/${wf.id}/instances`, 'POST', { title: '坏数据', data: {} }))
        .status,
      400,
    );
    const instance = (await (
      await request(
        `/workflows/${wf.id}/instances`,
        'POST',
        { title: 'HTTP 申请', data: raw },
        'u-lin',
      )
    ).json()) as Instance;
    const detail = (await (await request(`/instances/${instance.id}`)).json()) as { tasks: Task[] };
    const path = `/tasks/${detail.tasks[0].id}/actions`;
    assert.equal((await request(path, 'POST', { action: 'approve' }, 'u-lin')).status, 403);
    const results = await Promise.all([
      request(path, 'POST', { action: 'approve' }),
      request(path, 'POST', { action: 'approve' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  } finally {
    await app.close();
  }
});
