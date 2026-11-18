/**
 * 阅读性检查：确保每个手写源码/样式/脚本/SQL 文件都有文件职责注释。
 * 这不是注释质量评分，具体算法说明仍需代码评审；生成文件不在扫描范围。
 * JSON 不支持注释，其逐项说明统一放在 docs/configuration.md。
 */
import { readFileSync, readdirSync } from 'node:fs';

const roots = [
  'apps/api/src',
  'apps/api/test',
  'apps/web/src',
  'packages/bpm-core/src',
  'packages/bpm-core/test',
  'scripts',
  'docker',
];
const missing = [];
let count = 0;

function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      check(path);
      continue;
    }
    if (!/\.(?:ts|tsx|css|mjs|sql)$/.test(path)) continue;
    count++;
    const source = readFileSync(path, 'utf8').trimStart();
    if (!source.startsWith('/**') && !source.startsWith('/*') && !source.startsWith('--'))
      missing.push(path);
  }
}
roots.forEach(check);
if (missing.length) {
  console.error('缺少文件职责注释：\n' + missing.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `${count} 个手写源码文件均有文件职责注释。JSON 和生成文件请参阅 docs/configuration.md。`,
  );
