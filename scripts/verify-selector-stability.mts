// ============================================================
// selector 身份稳定性探针：zustand selector 不得在 selector 内部现拼
// 新对象/数组（?? {}、?? []、直接返回字面量等）。这类写法让
// useSyncExternalStore 的 getSnapshot 每次调用都变 → React 抛
// Maximum update depth exceeded、编辑器崩。实例：特征点 LandmarkControls
// 对「没标过的精灵」selector 内 ?? {} —— 已标的精灵返回存量对象不崩，
// 没标的一切换过去就崩，本探针钉住修复并给同类写法设全仓回归网。
//
// 三部分：
//  1) 机制断言（真 zustand 小 store）：旧形态 selector 对同一 state
//     连取两次身份必不等、新形态（模块级常量回落）必相等。注意这测的
//     是 selector 函数的返回值身份机制，不是 React 渲染本身。
//  2) 源码断言：ToolOptionPanels 的 LandmarkControls selector 无新鲜
//     字面量回落、且回落引用模块级常量 EMPTY_LANDMARKS。
//  3) 全仓回归网：提取 src/ 下全部 store hook 的 selector 函数体
//     （括号配平，覆盖多行 selector），断言无 selector 内新鲜字面量。
//     网的边界（先说清，命中时人工判定）：
//     - 漏报：selector 经外部 helper / 本地变量中转构造的新对象、
//       .map/.filter/Object.values 等派生构造、以及以标识符传入的
//       间接 selector（本仓当前为 0 个）不在本网形态内，靠人工审计。
//     - 误报：字面量作参数传入 selector 内部调用（如 foo({a:{…}})
//       的内层冒号）、参数内联对象类型注解（(s: {…}) => …）会被
//       三元分支形态误报。取舍是宁可误报吵闹、不可漏报静默。
// ============================================================

import { createStore } from 'zustand/vanilla';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}

// ---------- 1) 机制断言：旧形态必新、新形态必稳 ----------
interface LM { leftEye?: { x: number; y: number } }
interface MiniState { sprites: Record<string, { landmarks?: LM }> }
const store = createStore<MiniState>()(() => ({
  sprites: {
    bare: {}, // 精灵存在但没标过特征点
    marked: { landmarks: { leftEye: { x: 0.1, y: 0.2 } } },
  },
}));
const st = store.getState();

// 与修复前 LandmarkControls 逐字同形态（闭包变量换成入参 id）
const selOld = (s: MiniState, id: string | null) =>
  id ? s.sprites[id]?.landmarks ?? {} : {};
const EMPTY_LM: LM = {};
const selNew = (s: MiniState, id: string | null) =>
  id ? s.sprites[id]?.landmarks ?? EMPTY_LM : EMPTY_LM;

check('机制·旧形态:未标精灵连取两次身份不等', selOld(st, 'bare') !== selOld(st, 'bare'));
check('机制·旧形态:未选中连取两次身份不等', selOld(st, null) !== selOld(st, null));
check('机制·旧形态:已标精灵返回存量对象(稳定)', selOld(st, 'marked') === st.sprites['marked'].landmarks);
check('新形态:未标精灵连取两次身份相等', selNew(st, 'bare') === selNew(st, 'bare'));
check('新形态:未选中与未标回落同一常量', selNew(st, null) === selNew(st, 'bare'));
check('新形态:已标精灵仍返回存量对象本身', selNew(st, 'marked') === st.sprites['marked'].landmarks);

// ---------- selector 函数体提取（括号配平，覆盖多行写法） ----------
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const HOOKS = ['useProjectStore', 'useEditorStore', 'useAssetStore', 'usePuppetSessionStore', 'useWorkspaceStore'];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) yield p;
  }
}

type St = 'code' | 'sq' | 'dq' | 'tpl' | 'lc' | 'bc';
function extractParens(text: string, openIdx: number): { args: string; end: number } | null {
  let depth = 0, i = openIdx, braceDepth = 0;
  let st: St = 'code';
  const tplBraces: number[] = [];
  while (i < text.length) {
    const c = text[i], n = text[i + 1] ?? '';
    if (st === 'lc') { if (c === '\n') st = 'code'; i++; continue; }
    if (st === 'bc') { if (c === '*' && n === '/') { st = 'code'; i += 2; } else i++; continue; }
    if (st === 'sq') { if (c === '\\') i += 2; else { if (c === "'") st = 'code'; i++; } continue; }
    if (st === 'dq') { if (c === '\\') i += 2; else { if (c === '"') st = 'code'; i++; } continue; }
    if (st === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { st = 'code'; i++; continue; }
      if (c === '$' && n === '{') { tplBraces.push(braceDepth); st = 'code'; i += 2; continue; }
      i++; continue;
    }
    if (c === '/' && n === '/') { st = 'lc'; i += 2; continue; }
    if (c === '/' && n === '*') { st = 'bc'; i += 2; continue; }
    if (c === "'") { st = 'sq'; i++; continue; }
    if (c === '"') { st = 'dq'; i++; continue; }
    if (c === '`') { st = 'tpl'; i++; continue; }
    if (c === '{') { braceDepth++; i++; continue; }
    if (c === '}') {
      if (tplBraces.length && braceDepth === tplBraces[tplBraces.length - 1]) { tplBraces.pop(); st = 'tpl'; i++; continue; }
      braceDepth--; i++; continue;
    }
    if (c === '(') { depth++; i++; continue; }
    if (c === ')') { depth--; if (depth === 0) return { args: text.slice(openIdx + 1, i), end: i }; i++; continue; }
    i++;
  }
  return null;
}

// 把字符串/模板/注释内容抹成空格（保留长度与换行），免得字面量里的字符误触形态
function blankNoise(text: string): string {
  const out = text.split('');
  let i = 0, braceDepth = 0;
  let st: St = 'code';
  const tplBraces: number[] = [];
  const blank = (j: number) => { if (out[j] !== '\n') out[j] = ' '; };
  while (i < text.length) {
    const c = text[i], n = text[i + 1] ?? '';
    if (st === 'lc') { if (c === '\n') st = 'code'; else blank(i); i++; continue; }
    if (st === 'bc') { if (c === '*' && n === '/') { blank(i); blank(i + 1); st = 'code'; i += 2; } else { blank(i); i++; } continue; }
    if (st === 'sq') { blank(i); if (c === '\\') { blank(i + 1); i += 2; } else { if (c === "'") st = 'code'; i++; } continue; }
    if (st === 'dq') { blank(i); if (c === '\\') { blank(i + 1); i += 2; } else { if (c === '"') st = 'code'; i++; } continue; }
    if (st === 'tpl') {
      blank(i);
      if (c === '\\') { blank(i + 1); i += 2; continue; }
      if (c === '`') { st = 'code'; i++; continue; }
      if (c === '$' && n === '{') { blank(i + 1); tplBraces.push(braceDepth); st = 'code'; i += 2; continue; }
      i++; continue;
    }
    if (c === '/' && n === '/') { blank(i); blank(i + 1); st = 'lc'; i += 2; continue; }
    if (c === '/' && n === '*') { blank(i); blank(i + 1); st = 'bc'; i += 2; continue; }
    if (c === "'") { blank(i); st = 'sq'; i++; continue; }
    if (c === '"') { blank(i); st = 'dq'; i++; continue; }
    if (c === '`') { blank(i); st = 'tpl'; i++; continue; }
    if (c === '{') braceDepth++;
    if (c === '}') {
      if (tplBraces.length && braceDepth === tplBraces[tplBraces.length - 1]) { tplBraces.pop(); st = 'tpl'; blank(i); i++; continue; }
      braceDepth--;
    }
    i++;
  }
  return out.join('');
}

// selector 内新鲜字面量形态（硬失败）：回落 / 表达式体 / return / 三元分支
const FRESH_LITERAL_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: '回落字面量 ??', re: /\?\?\s*[[{]/g },
  { kind: '回落字面量 ||', re: /\|\|\s*[[{]/g },
  { kind: '表达式体字面量 => ({', re: /=>\s*\(\s*[[{]/g },
  { kind: '表达式体数组字面量 => [', re: /=>\s*\[/g },
  { kind: 'return 字面量', re: /\breturn\s*\(?\s*[[{]/g },
  { kind: '三元分支字面量 :', re: /:\s*[[{]/g },
  { kind: '三元分支字面量 ?', re: /\?\s*[[{]/g },
];

function freshLiteralHits(selectorArgs: string): string[] {
  const cleaned = blankNoise(selectorArgs);
  const kinds: string[] = [];
  for (const { kind, re } of FRESH_LITERAL_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(cleaned)) kinds.push(kind);
  }
  return kinds;
}

// ---------- 2) 源码断言：LandmarkControls 这一处 ----------
const panelsPath = join(SRC, 'components/pixel-editor/toolbar/ToolOptionPanels.tsx');
const panels = readFileSync(panelsPath, 'utf8');
check('源码:EMPTY_LANDMARKS 为模块级常量', /const EMPTY_LANDMARKS: SpriteLandmarks = \{\};/.test(panels));
const lmIdx = panels.indexOf('const landmarks = useProjectStore(');
check('源码:landmarks selector 存在', lmIdx >= 0);
if (lmIdx >= 0) {
  const ex = extractParens(panels, panels.indexOf('(', lmIdx));
  check('源码:landmarks selector 可提取', !!ex);
  if (ex) {
    check('源码:selector 回落引用 EMPTY_LANDMARKS', (ex.args.match(/EMPTY_LANDMARKS/g) ?? []).length === 2, ex.args.replace(/\s+/g, ' '));
    check('源码:selector 内无新鲜字面量', freshLiteralHits(ex.args).length === 0, freshLiteralHits(ex.args).join(','));
  }
}

// ---------- 3) 全仓回归网 ----------
let selectorCount = 0;
const netHits: string[] = [];
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  const lineOf = (idx: number) => text.slice(0, idx).split('\n').length;
  for (const hook of HOOKS) {
    const re = new RegExp(`\\b${hook}\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const ex = extractParens(text, m.index + m[0].length - 1);
      if (!ex) continue;
      const trimmed = ex.args.trim();
      if (trimmed === '') continue;
      const isFn = trimmed.startsWith('(') || trimmed.startsWith('function') || /^[A-Za-z_$][\w$]*\s*=>/.test(trimmed);
      if (!isFn) continue; // 间接 selector：网外（见头部边界说明）
      selectorCount++;
      const kinds = freshLiteralHits(ex.args);
      if (kinds.length) {
        netHits.push(`${file.replace(SRC, 'src')}:${lineOf(m.index)} [${hook}] ${kinds.join('/')}`);
      }
    }
  }
}
check('回归网:扫到足够多 selector(防网失效)', selectorCount > 400, `实际 ${selectorCount}`);
check('回归网:全仓 selector 内无新鲜字面量回落', netHits.length === 0, netHits.join(' | '));

console.log(`\nverify-selector-stability: ${pass} passed, ${fail} failed`);
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
