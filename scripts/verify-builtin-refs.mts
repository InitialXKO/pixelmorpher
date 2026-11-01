#!/usr/bin/env bun
// 内置装配参考图图库完整性：RefAssemblyWizard 的 BUILT_IN_REFS 列表与
// public/reference-demos/ 的实际文件必须互为全集——列表指的文件缺失则
// 向导里出破图，文件未进列表则永远选不到。顺带查重 id 与 url、标签非空。
//
// 跑法：bun scripts/verify-builtin-refs.mts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

const src = readFileSync(join(root, 'src/components/pixel-editor/puppet/RefAssemblyWizard.tsx'), 'utf8');
const blockMatch = src.match(/const BUILT_IN_REFS = \[([\s\S]*?)\];/);
check('能定位 BUILT_IN_REFS 列表', !!blockMatch);
const entries: { id: string; label: string; url: string }[] = [];
if (blockMatch) {
  const re = /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*url:\s*'([^']+)'\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockMatch[1])) !== null) entries.push({ id: m[1], label: m[2], url: m[3] });
}
check('列表至少 1 条', entries.length >= 1, `实际 ${entries.length} 条`);

const ids = new Set(entries.map((e) => e.id));
check('id 无重复', ids.size === entries.length);
const urls = new Set(entries.map((e) => e.url));
check('url 无重复', urls.size === entries.length);
check('标签全部非空', entries.every((e) => e.label.trim().length > 0));

const demoDir = join(root, 'public/reference-demos');
const files = readdirSync(demoDir).filter((f) => f.endsWith('.webp'));

for (const e of entries) {
  const rel = e.url.replace(/^\//, '');
  check(`文件存在 ${e.id}`, e.url.startsWith('/reference-demos/') && existsSync(join(root, 'public', rel)), e.url);
}
for (const f of files) {
  check(`文件已进列表 ${f}`, urls.has(`/reference-demos/${f}`));
}
check('文件数与列表数一致', files.length === entries.length, `文件 ${files.length} / 列表 ${entries.length}`);

console.log(`\nverify-builtin-refs: ${pass} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
