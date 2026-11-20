/**
 * 填单修复回归测试：复现小模型把证据写成解释、日期格式转换与部分候选失败的情况。
 * 不依赖模型随机输出；断言原文来源、数字边界和保留/跳过行为，而不是只验证对象形状。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTemplate } from '@bpm/core';
import { decodingSchema } from '../src/assistant/output-schema';
import { fillEvidenceCandidates, validateFillProposal } from '../src/assistant/fill-validation';

const fields = createTemplate('expense').fields;
const proposal = (
  values: Record<string, string | number>,
  fieldEvidence: Record<string, string> = {},
) => ({ fields: values, fieldEvidence, questions: [] });
const check = (
  text: string,
  values: Record<string, string | number>,
  evidence: Record<string, string> = {},
) => validateFillProposal(fields, text, proposal(values, evidence), '2026-11-20');

test('evidence explanations are repaired from real values including relative dates', () => {
  const result = check(
    '昨天差旅交通费420元，用于项目交付。',
    { category: '差旅交通', amount: 420, date: '2026-11-19', reason: '项目交付' },
    {
      category: '选择第一个类型',
      amount: '用户输入的金额数字',
      date: '根据 todayShanghai 解析昨天日期',
      reason: '从描述提取',
    },
  );
  assert.deepEqual(result.fields, {
    category: '差旅交通',
    amount: 420,
    date: '2026-11-19',
    reason: '项目交付',
  });
  assert.equal(result.fieldEvidence.date, '昨天');
  assert.equal(result.fieldEvidence.amount, '420');
  assert(result.warnings.length > 0);
});

test('one unsupported option does not discard the other valid fields', () => {
  const result = check('11月20日打车420元，用于项目交付。', {
    category: '差旅交通',
    amount: 420,
    date: '2026-11-20',
    reason: '项目交付',
  });
  assert.equal(result.fields.category, undefined);
  assert.equal(result.fields.amount, 420);
  assert.equal(result.fields.date, '2026-11-20');
  assert(result.questions.some((q) => q.includes('未写年份')));
  assert(result.questions.some((q) => q.includes('报销类型')));
});

test('different numbers, numeric substrings and calendar components are never repaired as amounts', () => {
  assert.equal(check('交通费1420元', { amount: 420 }, { amount: '420' }).fields.amount, undefined);
  assert.equal(check('交通费420元', { amount: 999 }).fields.amount, undefined);
  assert.equal(check('2026年11月20日去客户现场', { amount: 2026 }).fields.amount, undefined);
});

test('thousands separators, fullwidth digits and explicit units retain original evidence', () => {
  const result = check('交通费１，２８０．５０元', { amount: 1280.5 });
  assert.equal(result.fields.amount, 1280.5);
  assert.equal(result.fieldEvidence.amount, '１，２８０．５０');
  assert.equal(check('设备采购金额1.5万元', { amount: 15000 }).fields.amount, 15000);
});

test('explicit calendar dates are normalized but wrong or invalid dates are skipped', () => {
  const result = check('2026年11月18日交通费420元', { date: '2026-11-18' }, { date: '2026-11-18' });
  assert.equal(result.fields.date, '2026-11-18');
  assert.equal(result.fieldEvidence.date, '2026年11月18日');
  assert.equal(check('昨天打车420元', { date: '2026-11-18' }).fields.date, undefined);
  assert.equal(check('2026年2月30日打车420元', { date: '2026-03-02' }).fields.date, undefined);
});

test('valid quoted semantic classification remains supported but unknown fields are excluded', () => {
  const result = check(
    '去客户现场打车420元',
    { category: '差旅交通', amount: 420, invented: '越权字段' },
    { category: '去客户现场打车' },
  );
  assert.equal(result.fields.category, '差旅交通');
  assert.equal(result.fields.invented, undefined);
  assert(result.warnings.some((w) => w.includes('未定义')));
});

test('no grounded candidates returns explicit questions rather than inventing defaults', () => {
  const result = check('帮我准备一个申请', { amount: 999, category: '不存在的选项' });
  assert.deepEqual(result.fields, {});
  assert(result.questions.some((q) => q.includes('报销金额')));
});

test('native decoding restricts evidence keys and values to actual source spans', () => {
  const text = '昨天去客户现场打车420元。';
  const schema = decodingSchema({ feature: 'fill', schema: fields, userText: text });
  assert(
    schema.safeParse({ text: '提取完成', fields: { amount: 420 }, fieldEvidence: { amount: text } })
      .success,
  );
  const dated = decodingSchema({
    feature: 'fill',
    schema: fields,
    userText: text,
    todayShanghai: '2026-11-20',
  });
  assert(
    dated.safeParse({
      text: '提取完成',
      fields: { date: '2026-11-19' },
      fieldEvidence: { date: text },
    }).success,
  );
  assert(
    !dated.safeParse({
      text: '错误年份',
      fields: { date: '2025-11-19' },
      fieldEvidence: { date: text },
    }).success,
  );
  assert(
    !schema.safeParse({
      text: '提取完成',
      fields: { amount: 420 },
      fieldEvidence: { amount: '用户输入的金额数字' },
    }).success,
  );
  assert(
    !schema.safeParse({
      text: '提取完成',
      fields: { amount: 420 },
      fieldEvidence: { 报销金额: text },
    }).success,
  );
  const long = '申请说明。'.repeat(400) + '最后的独特用途：客户项目验收交付。';
  const candidates = fillEvidenceCandidates(long).filter(Boolean);
  assert(candidates.every((chunk) => chunk.length <= 1000 && long.includes(chunk)));
  assert(
    candidates.some((chunk) => chunk.includes('最后的独特用途：客户项目验收交付')),
    '不能只保留长原文开头而漏掉末尾事实',
  );
});
