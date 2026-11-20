/**
 * 自然语言填单的确定性校验/修复，不调用模型，也不修改业务表单。
 *
 * 小模型经常把 fieldEvidence 写成解释或规范化后的值。本模块先核对实际字段值，
 * 再从用户原文重新定位数字、日期或字面值；无法核实的候选逐项跳过，保留其他有效值。
 * “有原文依据”只证明能回溯提取来源，不等于已证明字段语义、票据或制度合规性。
 */
import { locateEvidence, validateForm, type FormField, type FormData } from '@bpm/core';

interface FillProposal {
  fields: FormData;
  fieldEvidence: Record<string, string>;
  questions: string[];
}

/** 规范化字符在原字符串中的区间，用于将全角数字等匹配结果恢复为真实原文。 */
interface NormalizedText {
  text: string;
  starts: number[];
  ends: number[];
  source: string;
}
interface Mention {
  value: string | number;
  quote: string;
  start: number;
  end: number;
  inferredYear?: boolean;
}

/** 原生约束解码可选的真实原文片段，限制单段长度且覆盖整段输入，不让模型自由编造“依据解释”。 */
export function fillEvidenceCandidates(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const point of text) {
    if (chunk.length + point.length > 800) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += point;
  }
  if (chunk) chunks.push(chunk);
  return [...new Set(['', ...(text.length <= 1000 && text ? [text] : []), ...chunks])];
}

/** NFKC 只统一全角等兼容字符；保留原文位置，不使用模糊相似度来接受不同事实。 */
function normalize(source: string): NormalizedText {
  let text = '';
  const starts: number[] = [],
    ends: number[] = [];
  let offset = 0;
  for (const point of source) {
    const converted = point.normalize('NFKC');
    for (let i = 0; i < converted.length; i++) {
      starts.push(offset);
      ends.push(offset + point.length);
    }
    text += converted;
    offset += point.length;
  }
  return { source, text, starts, ends };
}

/** 从规范化串的位置回到原始文本；报告中绝不把规范化生成的内容伪装成原文。 */
function mentionAt(
  input: NormalizedText,
  index: number,
  length: number,
  value: Mention['value'],
): Mention {
  const start = input.starts[index],
    end = input.ends[index + length - 1];
  return { value, quote: input.source.slice(start, end), start, end };
}

/** 只解析明确的年月日和少数相对日期，不猜测“下周一”等需要额外业务约定的表达。 */
function datesIn(text: string, today: string): Mention[] {
  const input = normalize(text);
  const result: Mention[] = [];
  const add = (
    match: RegExpMatchArray,
    year: number,
    month: number,
    day: number,
    inferredYear = false,
  ) => {
    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Date 会把 2 月 30 日滚动到下个月，必须转回字符串比较，避免接受无效日历日期。
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return;
    result.push({ ...mentionAt(input, match.index!, match[0].length, value), inferredYear });
  };
  for (const match of input.text.matchAll(
    /(?<!\d)(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})(?:\s*[日号])?(?!\d)/g,
  ))
    add(match, Number(match[1]), Number(match[2]), Number(match[3]));
  for (const match of input.text.matchAll(
    /(?<![\d年/])(?<month>\d{1,2})\s*(?:月|\/)\s*(?<day>\d{1,2})(?:\s*[日号])?(?!\d)/g,
  )) {
    const candidate = mentionAt(input, match.index!, match[0].length, '');
    if (result.some((date) => candidate.start >= date.start && candidate.end <= date.end)) continue;
    add(
      match,
      Number(today.slice(0, 4)),
      Number(match.groups!.month),
      Number(match.groups!.day),
      true,
    );
  }
  const offsets: Record<string, number> = {
    大前天: -3,
    前天: -2,
    昨天: -1,
    今天: 0,
    今日: 0,
    明天: 1,
    后天: 2,
    大后天: 3,
  };
  for (const match of input.text.matchAll(/大前天|大后天|前天|昨天|今天|今日|明天|后天/g)) {
    // today 已经是上海业务日期；以 UTC 的“日历零点”加天数，避免主机时区影响结果。
    const value = new Date(Date.parse(`${today}T00:00:00Z`) + offsets[match[0]] * 86400000)
      .toISOString()
      .slice(0, 10);
    result.push(mentionAt(input, match.index!, match[0].length, value));
  }
  return result;
}

/** 给原生解码提供可证明的日期候选；小模型只能从原文日期及确定性换算结果中选择。 */
export function fillDateCandidates(text: string, today: string): string[] {
  return [...new Set(datesIn(text, today).map(mention => String(mention.value)))];
}

/** 数字按完整 token 匹配，避免把 1420 中的 420 当成依据；支持千分位、小数和明确的万/千单位。 */
function numbersIn(text: string): Mention[] {
  const input = normalize(text);
  const result: Mention[] = [];
  const pattern = /[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*[万千百])?/g;
  for (const match of input.text.matchAll(pattern)) {
    const raw = match[0].replaceAll(',', '').replace(/\s/g, '');
    const unit = raw.at(-1)!;
    const multiplier = ({ 万: 10000, 千: 1000, 百: 100 } as Record<string, number>)[unit] || 1;
    const value = Number(multiplier === 1 ? raw : raw.slice(0, -1)) * multiplier;
    if (Number.isFinite(value)) result.push(mentionAt(input, match.index!, match[0].length, value));
  }
  return result;
}

/** 允许原有的空白归一化；若是全角字符差异，匹配后同样恢复原串，不移除数字或改写词义。 */
function literalEvidence(text: string, quote: string): string | undefined {
  if (!quote.trim()) return undefined;
  const direct = locateEvidence(text, quote);
  if (direct) return direct;
  const input = normalize(text),
    wanted = quote.normalize('NFKC');
  const found = locateEvidence(input.text, wanted);
  const index = found ? input.text.indexOf(found) : -1;
  return index < 0 ? undefined : mentionAt(input, index, found!.length, '').quote;
}

/**
 * 校验整份模型提案，返回可填入的子集。
 * 重要：从全份原文重新定位时，只接受相同数字/日期/字面值，不把相近金额或模型解释作为证据。
 */
export function validateFillProposal(
  fields: FormField[],
  text: string,
  proposal: FillProposal,
  today: string,
) {
  const values = { ...proposal.fields },
    evidence = { ...proposal.fieldEvidence };
  const clean: FormData = {},
    verified: Record<string, string> = {};
  const questions = [...proposal.questions],
    warnings: string[] = [];
  const dateMentions = datesIn(text, today);
  // 日期中的年份、月份不能被误恢复成报销金额/天数的依据。
  const numberMentions = numbersIn(text).filter(
    (number) => !dateMentions.some((date) => number.start >= date.start && number.end <= date.end),
  );
  const purpose = text.match(/(?:^|[，,。；;\n])(?:用于|用途为)([^。；;\n]{2,300})/);
  if (!values.reason && purpose && fields.some((field) => field.key === 'reason')) {
    values.reason = purpose[1].trim();
    evidence.reason = purpose[0].replace(/^[，,。；;\n]/, '');
  }
  for (const [key, raw] of Object.entries(values)) {
    if (!String(raw).trim()) continue;
    const field = fields.find((field) => field.key === key);
    if (!field) {
      warnings.push(`未定义的候选字段「${key}」已忽略`);
      continue;
    }
    let value: string | number;
    try {
      value = validateForm([{ ...field, required: true }], { [key]: raw })[key];
    } catch {
      questions.push(`「${field.label}」提取值不合法，已跳过，请手动确认`);
      continue;
    }
    const quoted = literalEvidence(text, evidence[key] || '');
    let quote = quoted;
    if (field.type === 'number' || field.type === 'date') {
      const matches = (field.type === 'number' ? numberMentions : dateMentions).filter(
        (item) => item.value === value,
      );
      // 优先使用模型所引原文支持的同值 token，否则从实际原文中的同值 token 恢复。
      const match =
        matches.find((item) => quoted && literalEvidence(quoted, item.quote)) || matches[0];
      if (!match) {
        questions.push(
          `「${field.label}」的${field.type === 'number' ? '数字' : '日期'}无法与原文核对，已跳过，请手动填写`,
        );
        continue;
      }
      quote = quoted && literalEvidence(quoted, match.quote) ? quoted : match.quote;
      if (match.inferredYear)
        questions.push(`「${field.label}」未写年份，按 ${today.slice(0, 4)} 年推定，请确认`);
    } else if (!quote) {
      // 文本或选项只在其字面值确实出现在原文时修复。不能因“电脑”像“办公设备”就替模型伪造依据。
      quote = literalEvidence(text, String(value));
    }
    if (!quote) {
      questions.push(`「${field.label}」缺少可核对的原文依据，已跳过，请手动确认`);
      continue;
    }
    if (!quoted || quoted !== quote)
      warnings.push(`「${field.label}」的依据已从原文重新定位，请核对候选值`);
    clean[key] = value;
    verified[key] = quote;
  }
  for (const field of fields)
    if (field.required && clean[field.key] === undefined)
      questions.push(`请确认「${field.label}」`);
  return { fields: clean, fieldEvidence: verified, questions: [...new Set(questions)], warnings };
}
