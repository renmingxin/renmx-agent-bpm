/** 助手规则的业务边界测试：金额临界值、字段异常与实际/模拟路线隔离。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTemplate, detectFieldAnomalies, explainRoute, locateEvidence } from '../src';

test('evidence normalizes only whitespace and returns actual source text', () => {
  assert.equal(locateEvidence('交通费420元，用于交付', '420 元'), '420元');
  assert.equal(locateEvidence('交通费420元', '430元'), undefined);
  assert.equal(locateEvidence('交通费420元', '  '), undefined);
});

const values = { category: '差旅交通', amount: 3000, date: '2026-11-18', reason: '客户现场交付' };
test('anomalies report all required/format issues and known business semantics', () => {
  const def = createTemplate('expense');
  const missing = detectFieldAnomalies(
    def,
    { amount: 'NaN', category: '不存在', date: '2026-02-30' },
    '2026-11-19',
  );
  assert.equal(missing.filter((f) => f.severity === 'error').length, 4);
  const abnormal = detectFieldAnomalies(
    def,
    { ...values, amount: -1, date: '2026-11-20' },
    '2026-11-19',
  );
  assert.deepEqual(
    abnormal.map((f) => f.fieldKey),
    ['amount', 'date'],
  );
  assert.equal(
    detectFieldAnomalies(def, { ...values, amount: 9000 }, '2026-11-19').length,
    0,
    '路由阈值不是费用合规限额',
  );
});
test('route explanation uses exact snapshot threshold without creating tasks', () => {
  const def = createTemplate('expense');
  const before = JSON.stringify(def);
  assert(!explainRoute(def, values).some((s) => s.nodeId === 'finance'));
  assert(explainRoute(def, { ...values, amount: 3000.01 }).some((s) => s.nodeId === 'finance'));
  assert(explainRoute(def, values).every((s) => s.mode === 'predicted'));
  assert.equal(JSON.stringify(def), before);
});
test('custom numeric fields do not inherit amount-specific anomaly rules', () => {
  const def = createTemplate('blank');
  def.fields = [{ id: 'temp', key: 'temperature', label: '温度', type: 'number', required: true }];
  assert.deepEqual(detectFieldAnomalies(def, { temperature: -10 }), []);
});
