/**
 * 真实 PostgreSQL + LangGraph 集成测试；模型替身只替换外部生成，不替代检索与业务校验。
 * 最后一个用例使用本地 HTTP 协议服务验证真正的 ChatOpenAI 适配路径，不消耗外部模型费用。
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createServer } from 'node:http';
import {
  assistantInputSchema,
  policyInputSchema,
  type AssistantInput,
  type ModelChoice,
} from '@bpm/core';
import { Store } from '../src/store';
import { BpmService } from '../src/bpm.service';
import { ModelGateway } from '../src/assistant/model-gateway';
import { PolicyService, cosine } from '../src/assistant/policy.service';
import { AssistantService } from '../src/assistant/assistant.service';
import { createApp } from '../src/main';

class FakeModel extends ModelGateway {
  calls = 0;
  answer: unknown = { text: '建议核对后处理。' };
  effect?: () => Promise<void>;
  override async generate(
    _choice: ModelChoice,
    _system: string,
    _context: unknown,
    _signal: AbortSignal,
  ) {
    this.calls++;
    if (this.effect) await this.effect();
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}
async function fixture(t: TestContext) {
  const url =
    process.env.TEST_DATABASE_URL || 'postgresql://bpm:bpm_dev_password@127.0.0.1:5440/bpm_test';
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('仅允许独立 _test 数据库');
  process.env.DATABASE_URL = url;
  process.env.BPM_SEED = 'false';
  process.env.ASSISTANT_EMBEDDING_PROVIDER = 'keyword';
  const store = new Store();
  await store.initialize();
  t.after(() => store.onModuleDestroy());
  const bpm = new BpmService(store);
  const model = new FakeModel();
  const policies = new PolicyService(store, model);
  await policies.initialize();
  await store.pool.query(
    'TRUNCATE assistant_policies, assistant_reports, tasks, instances, workflows CASCADE',
  );
  const workflow = await bpm.create('助手测试报销', 'expense');
  await bpm.publish(workflow.id, workflow.revision);
  const values = { category: '差旅交通', amount: 4200, date: '2026-11-18', reason: '客户现场交付' };
  const instance = await bpm.start(workflow.id, 'u-lin', '助手测试', values);
  const service = new AssistantService(bpm, model, policies);
  return { store, bpm, model, policies, service, instance, workflow, values };
}
const request = (input: Partial<AssistantInput>) => assistantInputSchema.parse(input);
const policy = (overrides = {}) =>
  policyInputSchema.parse({
    title: '演示费用制度',
    version: 1,
    category: 'expense',
    effectiveFrom: '2020-01-01',
    content: '差旅交通费报销需要提供行程说明和相应票据。财务审核时应核对费用用途及票据金额。',
    ...overrides,
  });

test('route runs without a model; only participants can read assistant context', async (t) => {
  const { service, model, instance, store } = await fixture(t);
  const result = await service.run(
    request({ feature: 'route', instanceId: instance.id }),
    'u-chen',
  );
  assert(result.route.some((s) => s.mode === 'actual'));
  assert(result.route.some((s) => s.mode === 'predicted' && s.nodeId === 'finance'));
  assert.equal(model.calls, 0);
  await assert.rejects(
    () => service.run(request({ feature: 'route', instanceId: instance.id }), 'u-wang'),
    /不能读取/,
  );
  assert.equal((await store.all('tasks')).filter((t) => t.status === 'pending').length, 1);
});
test('fill validates field keys, values and exact evidence, never starts an instance', async (t) => {
  const { service, model, workflow, store } = await fixture(t);
  model.answer = {
    text: '提取候选值',
    fields: { amount: 420, category: '差旅交通' },
    fieldEvidence: { amount: '420元', category: '差旅' },
  };
  const result = await service.run(
    request({ feature: 'fill', workflowId: workflow.id, text: '差旅交通费420元' }),
    'u-lin',
  );
  assert.equal(result.fields.amount, 420);
  assert(result.questions.some((q) => q.includes('日期')));
  assert.equal((await store.all('instances')).length, 1);
  model.answer = { text: '虚构', fields: { amount: 999 }, fieldEvidence: { amount: '原文不存在' } };
  await assert.rejects(
    () =>
      service.run(
        request({ feature: 'fill', workflowId: workflow.id, text: '差旅420元' }),
        'u-lin',
      ),
    /原文依据/,
  );
});
test('draft requires current assignee and persists advice without approving', async (t) => {
  const { service, model, instance, store } = await fixture(t);
  model.answer = { text: '按流程提交财务继续审核。' };
  await assert.rejects(
    () => service.run(request({ feature: 'draft', instanceId: instance.id }), 'u-lin'),
    /当前待办/,
  );
  const result = await service.run(
    request({ feature: 'draft', instanceId: instance.id }),
    'u-chen',
  );
  assert.equal(result.text, '按流程提交财务继续审核。');
  assert.equal((await store.get('instances', instance.id))!.currentNodeId, 'manager');
  assert.equal(
    (await store.pool.query('SELECT count(*) FROM assistant_reports')).rows[0].count,
    '1',
  );
});
test('RAG filters category, effective dates, latest enabled version and exposes source text', async (t) => {
  const { policies } = await fixture(t);
  await policies.import(policy(), 'u-chen');
  const next = await policies.import(
    policy({
      version: 2,
      content: '差旅交通费报销需要提供行程、票据及客户项目用途说明。新版本用于交通费审核。',
    }),
    'u-chen',
  );
  await policies.import(policy({ title: '未来制度', effectiveFrom: '2099-01-01' }), 'u-chen');
  await policies.import(
    policy({
      title: '请假制度',
      category: 'leave',
      content: '请假时填写请假日期及请假天数，提交部门负责人审核。',
    }),
    'u-chen',
  );
  const sources = await policies.search('差旅交通费票据', 'expense', '2026-11-18');
  assert(sources.length > 0 && sources.every((s) => s.documentId === next.id));
  assert(sources[0].text.includes('客户项目'));
  await policies.setEnabled(next.id, false);
  assert(
    (await policies.search('差旅交通费票据', 'expense', '2026-11-18')).every(
      (s) => s.version === 1,
    ),
  );
  await assert.rejects(() => policies.import(policy(), 'u-chen'), /版本的制度已存在/);
});
test('RAG abstains on no evidence and blocks fabricated citations', async (t) => {
  const { service, model, policies } = await fixture(t);
  const empty = await service.run(
    request({ feature: 'policy', text: '差旅票据需要什么？' }),
    'u-lin',
  );
  assert(empty.text.includes('未检索到'));
  assert.equal(model.calls, 0);
  await policies.import(policy(), 'u-chen');
  model.answer = { text: '交通费要票据。', citationIds: ['S1'] };
  const result = await service.run(
    request({ feature: 'policy', text: '差旅票据需要什么？' }),
    'u-lin',
  );
  assert.equal(result.sources[0].title, '演示费用制度');
  model.answer = { text: '编造来源', citationIds: ['S999'] };
  await assert.rejects(
    () => service.run(request({ feature: 'policy', text: '差旅票据需要什么？' }), 'u-lin'),
    /未检索到的条款/,
  );
});
test('anomalies preserve deterministic findings when semantic model fails', async (t) => {
  const { service, model, instance, values } = await fixture(t);
  model.answer = new Error('unavailable');
  const result = await service.run(
    request({ feature: 'anomalies', instanceId: instance.id, data: { ...values, amount: -1 } }),
    'u-chen',
  );
  assert(result.findings.some((f) => f.fieldKey === 'amount' && f.source === 'rule'));
  assert(result.warnings.includes('语义模型不可用'));
});
test('generation crossing an approval state change is rejected as stale', async (t) => {
  const { service, model, instance, bpm, store } = await fixture(t);
  model.effect = async () => {
    const task = (await store.all('tasks'))[0];
    await bpm.act(task.id, 'u-chen', 'approve', '测试期间另一个窗口审批');
  };
  await assert.rejects(
    () => service.run(request({ feature: 'draft', instanceId: instance.id }), 'u-chen'),
    /当前待办|版本已变化/,
  );
  assert.equal(
    (await store.pool.query('SELECT count(*) FROM assistant_reports')).rows[0].count,
    '0',
  );
});

test('draft route claims are checked against the engine rather than trusting the model', async (t) => {
  const { service, model, instance, values } = await fixture(t);
  model.answer = { text: '下一步提交财务负责人审批。' };
  await assert.rejects(
    () =>
      service.run(
        request({ feature: 'draft', instanceId: instance.id, data: { ...values, amount: 420 } }),
        'u-chen',
      ),
    /不属于当前路线/,
  );
});

test('unsupported compliance conclusions fall back to verifiable application facts', async (t) => {
  const { service, model, instance } = await fixture(t);
  model.answer = { text: '金额符合公司差旅标准，建议同意。' };
  const result = await service.run(
    request({ feature: 'draft', instanceId: instance.id }),
    'u-chen',
  );
  assert(!result.text.includes('符合公司'));
  assert(result.text.includes('4200'));
  assert(result.warnings.some((w) => w.includes('未经规则证实')));
});

test('a newly applicable policy version invalidates an in-flight cited answer', async (t) => {
  const { policies, model, service } = await fixture(t);
  await policies.import(policy(), 'u-chen');
  model.answer = { text: '需要票据', citationIds: ['S1'] };
  model.effect = async () => {
    await policies.import(policy({ version: 2 }), 'u-chen');
  };
  await assert.rejects(
    () => service.run(request({ feature: 'policy', text: '差旅票据需要什么？' }), 'u-lin'),
    /新的适用版本/,
  );
});

test('unsupported semantic claims are discarded while grounded rule findings remain', async (t) => {
  const { service, model, instance, values } = await fixture(t);
  model.answer = {
    text: '有风险',
    anomalies: [{ fieldKey: 'amount', message: '无法核实的提示', evidence: '不存在的原文' }],
  };
  const result = await service.run(
    request({ feature: 'anomalies', instanceId: instance.id, data: { ...values, amount: -1 } }),
    'u-chen',
  );
  assert(result.findings.some((f) => f.source === 'rule'));
  assert(!result.findings.some((f) => f.source === 'model'));
  assert(result.warnings.some((w) => w.includes('已排除')));
});
test('plain text upload persists across pools and vector comparison rejects incompatible dimensions', async (t) => {
  const { policies, store, model } = await fixture(t);
  const content = '差旅报销制度：应填写费用发生日期与项目用途，并提供交通票据供财务核对。';
  await policies.import(
    policy({
      content: undefined,
      file: { name: '规则.md', base64: Buffer.from(content).toString('base64') },
    }),
    'u-chen',
  );
  const second = new Store();
  t.after(() => second.onModuleDestroy());
  const restored = new PolicyService(second, model);
  assert.equal((await restored.list()).length, 1);
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1], [1, 0]), 0);
  assert.equal(
    (await store.pool.query('SELECT count(*) FROM assistant_policies')).rows[0].count,
    '1',
  );
});
test('HTTP hides keys, checks identity and prevents non-editors importing policies', async (t) => {
  await fixture(t);
  const app = await createApp({ logger: false });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const url = await app.getUrl();
  assert.equal((await fetch(`${url}/api/assistant/config`)).status, 401);
  const config = await (
    await fetch(`${url}/api/assistant/config`, { headers: { 'x-user-id': 'u-lin' } })
  ).text();
  assert(!config.includes('apiKey'));
  const response = await fetch(`${url}/api/assistant/policies`, {
    method: 'POST',
    headers: { 'x-user-id': 'u-lin', 'Content-Type': 'application/json' },
    body: JSON.stringify(policy()),
  });
  assert.equal(response.status, 403);
});
test('ChatOpenAI adapter sends the chosen model to a configurable compatible endpoint', async (t) => {
  let selected = '';
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    selected = JSON.parse(body).model;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'local',
        object: 'chat.completion',
        created: 1,
        model: selected,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"text":"兼容模型响应"}' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const oldUrl = process.env.OPENAI_BASE_URL;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENAI_API_KEY = 'test-only';
  try {
    const result = await new ModelGateway().generate(
      { provider: 'openai', model: 'my-custom-model' },
      'JSON only',
      {},
      AbortSignal.timeout(5000),
    );
    assert.deepEqual(result, { text: '兼容模型响应' });
    assert.equal(selected, 'my-custom-model');
  } finally {
    if (oldUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
