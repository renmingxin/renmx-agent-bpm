/**
 * 纯引擎测试：不依赖浏览器或数据库。
 * 重点覆盖条件边界、图结构错误、字段校验与循环终止保护；先读断言再读实现。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advance,
  createTemplate,
  definitionSchema,
  definitionSignature,
  validateDefinition,
  validateForm,
} from '../src/index';

test('all supplied templates are publishable', () => {
  for (const type of ['expense', 'leave', 'purchase', 'blank'] as const) {
    const definition = createTemplate(type);
    assert.equal(definitionSchema.safeParse(definition).success, true);
    assert.deepEqual(validateDefinition(definition), []);
  }
});
test('definition comparisons ignore JSONB key ordering but preserve field order', () => {
  const def = createTemplate('expense');
  const reordered = JSON.parse(
    JSON.stringify(def, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  assert.equal(definitionSignature(def), definitionSignature(reordered));
  reordered.fields.reverse();
  assert.notEqual(definitionSignature(def), definitionSignature(reordered));
});
test('small amount and exact threshold skip finance; larger amount requires finance', () => {
  const def = createTemplate('expense');
  for (const amount of [100, 3000]) {
    const result = advance(def, 'manager', { amount });
    assert.equal(result.next.id, 'end');
    assert.match(result.transitions[0].detail, /否则分支/);
  }
  assert.equal(advance(def, 'manager', { amount: 3000.01 }).next.id, 'finance');
  assert.equal(advance(def, 'finance', { amount: 4000 }).next.id, 'end');
});
test('every numeric comparison has matching and fallback paths', () => {
  for (const [operator, yes, no] of [
    ['gt', 11, 10],
    ['gte', 10, 9],
    ['lt', 9, 10],
    ['lte', 10, 11],
    ['eq', 10, 11],
  ] as const) {
    const def = createTemplate('expense');
    def.nodes.find((n) => n.id === 'condition')!.data.condition = {
      field: 'amount',
      operator,
      value: 10,
    };
    assert.equal(advance(def, 'manager', { amount: yes }).next.id, 'finance');
    assert.equal(advance(def, 'manager', { amount: no }).next.id, 'end');
  }
});
test('publication rejects unreachable nodes, cycles, ambiguous paths and unknown assignees', () => {
  const disconnected = createTemplate('blank');
  disconnected.nodes.push({
    id: 'orphan',
    type: 'bpm',
    position: { x: 0, y: 0 },
    data: { kind: 'end', label: '孤立节点' },
  });
  assert.match(validateDefinition(disconnected).join(), /到达/);
  const cyclic = createTemplate('blank');
  cyclic.edges.push({ id: 'cycle', source: 'manager', target: 'start' });
  assert.match(validateDefinition(cyclic).join(), /循环/);
  const unknown = createTemplate('blank');
  unknown.nodes[1].data.assignee = 'u-missing';
  assert.match(validateDefinition(unknown).join(), /审批人/);
});
test('publication rejects invalid condition fields and missing fallback', () => {
  const def = createTemplate('expense');
  def.fields.find((f) => f.key === 'amount')!.required = false;
  def.edges = def.edges.filter((e) => e.sourceHandle !== 'no');
  const errors = validateDefinition(def).join();
  assert.match(errors, /必填数字/);
  assert.match(errors, /两条分支/);
});
test('duplicate field identifiers and reserved keys cannot be published', () => {
  const def = createTemplate('blank');
  def.fields.push({ ...def.fields[0], id: 'another' });
  assert.match(validateDefinition(def).join(), /标识不能重复/);
  def.fields[0].key = 'constructor';
  assert.match(validateDefinition(def).join(), /保留/);
});
test('form validation enforces required data, selection, finite numbers and calendar dates', () => {
  const fields = createTemplate('expense').fields;
  const valid = {
    category: '差旅交通',
    amount: '123.45',
    date: '2026-11-18',
    reason: '  客户拜访  ',
    extra: 'ignored',
  };
  assert.deepEqual(validateForm(fields, valid), {
    category: '差旅交通',
    amount: 123.45,
    date: '2026-11-18',
    reason: '客户拜访',
  });
  for (const invalid of [
    { ...valid, amount: 'NaN' },
    { ...valid, amount: Infinity },
    { ...valid, category: '伪造类型' },
    { ...valid, date: '2026-02-30' },
    { ...valid, reason: ' ' },
  ])
    assert.throws(() => validateForm(fields, invalid));
});
test('runtime guard terminates even on malformed cyclic graph', () => {
  const def = createTemplate('expense');
  def.edges.find((e) => e.id === 'condition-finance')!.target = 'condition';
  assert.throws(() => advance(def, 'manager', { amount: 4000 }), /循环/);
});
