// ============================================================
// 术语归正探针（2026-11 全系统审计·文案批）：
//  1) 用户可见文件集（src + docs + wiki + 根目录 *.md，不含
//     spikes 审计记录与 scripts 探针自身）中「插槽」「修饰器」
//     零残留——Socket 的规范称呼是「槽位」，Modifier 是「修改器」。
//  2) 服装件语境「槽位」零残留：纯服装语境文件（无 Socket 义）
//     里每个「槽位」都必须是「服装槽」的一部分；混义文件用
//     关键改名串的存在性断言钉住两边（服装槽 / 槽位各归其位）。
//  3) 蓝图 10 个节点类型（bump_light 等）标签均为中文。
//  4) 旧文档（AUDIT_REPORT / MIGRATION_STATUS / docs / wiki）
//     头部含过期声明；wiki PuppetSystem 的 Socket/Plug 定义
//     带就地更正注。
//  5) 「宿主」两指消歧注释在位（host-fx 宿主像素 /
//     behavior-host 行为宿主）。
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLUEPRINT_NODE_LABELS, getBlueprintNodeLabel } from '../src/lib/blueprint/eval';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}

// ---------- 文件集收集 ----------
function walk(dir: string, exts: string[], out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, exts, out); continue; }
    if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
}
const visibleFiles: string[] = [];
walk(join(ROOT, 'src'), ['.ts', '.tsx'], visibleFiles);
walk(join(ROOT, 'docs'), ['.md'], visibleFiles);
walk(join(ROOT, 'wiki'), ['.md'], visibleFiles);
for (const name of readdirSync(ROOT)) {
  if (name.endsWith('.md')) visibleFiles.push(join(ROOT, name));
}
const contents = new Map<string, string>();
for (const f of visibleFiles) contents.set(f, readFileSync(f, 'utf-8'));
const rel = (f: string) => relative(ROOT, f);

// ---------- 1) 「插槽」「修饰器」零残留 ----------
for (const word of ['插槽', '修饰器']) {
  const offenders = visibleFiles.filter((f) => contents.get(f)!.includes(word)).map(rel);
  check(`「${word}」在用户可见文件集零残留`, offenders.length === 0, offenders.join(', '));
}

// ---------- 2) 服装件语境「槽位」零残留 ----------
// 纯服装语境文件：不许出现「服装槽」以外的「槽位」
const strictCostumeFiles = [
  'src/components/pixel-editor/puppet/DressPanel.tsx',
  'src/components/pixel-editor/puppet/DynamicPatternEditor.tsx',
  'src/components/pixel-editor/puppet/ParametricAppearanceEditor.tsx',
  'src/components/pixel-editor/puppet/StateBlueprintEditor.tsx',
  'src/components/pixel-editor/puppet/use-blueprint-preview-data.ts',
  'src/lib/blueprint/eval.ts',
  'src/lib/blueprint/specs.ts',
  'src/lib/clone-transpose.ts',
  'src/lib/dynamic-patterns.ts',
  'src/lib/sprite-resolve.ts',
  'src/lib/proc-runtime/convert.ts',
  'src/lib/proc-runtime/graph-translate.ts',
  'src/lib/proc-runtime/runtime-template.ts',
  'src/lib/store/character-slice.ts',
  'src/lib/store/editor-store.ts',
  'src/lib/unified-render.ts',
  'docs/render-pipeline.md',
];
for (const r of strictCostumeFiles) {
  const text = readFileSync(join(ROOT, r), 'utf-8');
  const stripped = text.split('服装槽').join('');
  check(`${r} 无「服装槽」以外的「槽位」`, !stripped.includes('槽位'));
}
// 混义文件：关键改名串两边都在位
const presence: Array<[string, string]> = [
  ['src/components/pixel-editor/PuppetAssetPanel.tsx', '个服装槽'],       // 服装集 pieces 数
  ['src/components/pixel-editor/PuppetAssetPanel.tsx', '的槽位'],         // Socket 编辑区标题
  ['src/components/pixel-editor/puppet/RigPanel.tsx', '添加槽位'],        // Socket
  ['src/components/pixel-editor/puppet/RigPanel.tsx', '服装槽'],          // 参数化外观按服装槽存
  ['src/lib/unified-types.ts', '服装槽变体指派'],
  ['src/lib/unified-types.ts', '同一服装槽在不同服装集'],
  ['README.md', '逐服装槽（服装件'],
];
for (const [r, s] of presence) {
  check(`${r} 含「${s}」`, readFileSync(join(ROOT, r), 'utf-8').includes(s));
}

// ---------- 3) 蓝图 10 节点中文标签 ----------
const TEN = [
  'bump_light', 'face_turn', 'local_inflate', 'path_follow', 'path_move',
  'screen', 'stroke_emitter', 'stroke_source', 'trajectory_emitter', 'trajectory_source',
];
for (const t of TEN) {
  const label = getBlueprintNodeLabel(t);
  check(`蓝图节点 ${t} 有中文标签`, label !== t && /[\u4e00-\u9fff]/.test(label), `实际=${label}`);
  check(`BLUEPRINT_NODE_LABELS[${t}] 已登记`, typeof BLUEPRINT_NODE_LABELS[t] === 'string');
}

// ---------- 4) 旧文档过期标注 ----------
const legacyDocs = [
  'AUDIT_REPORT.md', 'MIGRATION_STATUS.md', 'docs/render-pipeline.md',
  'wiki/Architecture_CN.md', 'wiki/ModifierReference_CN.md', 'wiki/PluginDevelopment_CN.md',
  'wiki/PuppetSystem_CN.md', 'wiki/TileWorkflow_CN.md', 'wiki/UserGuide_CN.md',
];
for (const r of legacyDocs) {
  const head = readFileSync(join(ROOT, r), 'utf-8').slice(0, 300);
  check(`${r} 头部含过期声明`, head.includes('已过期') && head.includes('spikes/system-audit/AUDIT.md'));
}
const puppetWiki = readFileSync(join(ROOT, 'wiki/PuppetSystem_CN.md'), 'utf-8');
check('wiki Socket 定义带更正注（在节点上）', puppetWiki.includes('更正：Socket 定义在**节点**上'));
check('wiki Plug 定义带更正注（插头=精灵帧内偏移）', puppetWiki.includes('Plug 应译「插头」') && puppetWiki.includes('精灵帧内的对位偏移'));

// ---------- 5) 宿主两指消歧 ----------
const hostFxHead = readFileSync(join(ROOT, 'src/lib/host-fx.ts'), 'utf-8').slice(0, 600);
check('host-fx 头注点明宿主像素与行为宿主之别', hostFxHead.includes('宿主像素') && hostFxHead.includes('行为宿主'));
const behaviorHostHead = readFileSync(join(ROOT, 'src/lib/behavior-host.ts'), 'utf-8').slice(0, 600);
check('behavior-host 头注点明行为宿主与宿主像素之别', behaviorHostHead.includes('行为宿主') && behaviorHostHead.includes('宿主像素'));

console.log(`verify-terminology: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
