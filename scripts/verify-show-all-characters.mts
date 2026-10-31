// ============================================================
// 「显示全部角色」开关接线探针：开关写 puppet-session-store 的
// showAllCharacters，消费端必须真过滤——主渲染画谁、拾取能点中谁、
// 骨骼覆盖层漏不漏，都由 lib/visible-characters 的同一口径决定。
// 历史断点：PixelCanvas 主渲染把角色全表原样传 renderUnified，
// filterVisibleCharacters 定义了从未被调用，点开关只有洋葱皮变、
// 主画面不动。
//
// 三部分：
//  1) 纯函数真测：filterVisibleCharacters 四分支（开→全；
//     关+操控角色在表→仅它；关+操控角色不在表→回退全；
//     关+无操控角色→全）。
//  2) visibleCharactersRecord：未过滤时原表同一性直传（拾取戳记
//     sameStamp 靠 === ）；真过滤时只含可见角色、且同输入连取
//     两次返回同一对象（绘制侧与读侧必须拿到同一份，戳记才
//     对得上）；换操控角色/换表同一性后重算。
//  3) 源码接线断言：PixelCanvas 主渲染与 beginPickFrame 消费
//     同一份 visibleCharactersRecord 结果、骨骼覆盖层过
//     filterVisibleCharacters、洋葱皮收敛同一函数；拾取读侧
//     （use-canvas-state）期望戳记与几何兜底输入同为可见集。
//     把接线退回全表直传时本部分必须红（已做还原自查）。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterVisibleCharacters, visibleCharactersRecord } from '../src/lib/visible-characters';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------- 1) filterVisibleCharacters 四分支 ----------
type Ch = { id: string };
const A: Ch = { id: 'a' };
const B: Ch = { id: 'b' };
const C: Ch = { id: 'c' };
const all: Ch[] = [A, B, C];
const ids = (xs: Ch[]) => xs.map((c) => c.id).join(',');

check('1.1 showAll 开 → 全部（且原数组直传）',
  filterVisibleCharacters(all, { showAllCharacters: true, performCharacterId: 'b' }) === all);
check('1.2 关 + 操控角色在表 → 仅该角色',
  ids(filterVisibleCharacters(all, { showAllCharacters: false, performCharacterId: 'b' })) === 'b');
check('1.3 关 + 操控角色不在表 → 回退全部',
  ids(filterVisibleCharacters(all, { showAllCharacters: false, performCharacterId: 'ghost' })) === 'a,b,c');
check('1.4 关 + 无操控角色 → 全部',
  ids(filterVisibleCharacters(all, { showAllCharacters: false, performCharacterId: null })) === 'a,b,c');
check('1.5 空表 → 空',
  filterVisibleCharacters([], { showAllCharacters: false, performCharacterId: 'b' }).length === 0);

// ---------- 2) visibleCharactersRecord ----------
const table: Record<string, Ch> = { a: A, b: B, c: C };

check('2.1 未过滤（showAll 开）→ 原表同一性直传',
  visibleCharactersRecord(table, { showAllCharacters: true, performCharacterId: 'b' }) === table);
check('2.2 未过滤（无操控角色）→ 原表同一性直传',
  visibleCharactersRecord(table, { showAllCharacters: false, performCharacterId: null }) === table);
check('2.3 未过滤（操控角色不在表，回退全）→ 原表同一性直传',
  visibleCharactersRecord(table, { showAllCharacters: false, performCharacterId: 'ghost' }) === table);

const filtered1 = visibleCharactersRecord(table, { showAllCharacters: false, performCharacterId: 'b' });
check('2.4 真过滤 → 只含操控角色、且不是原表',
  !!filtered1 && filtered1 !== table && ids(Object.values(filtered1)) === 'b');
const filtered2 = visibleCharactersRecord(table, { showAllCharacters: false, performCharacterId: 'b' });
check('2.5 同输入连取两次 → 同一对象（戳记同一性）', filtered1 === filtered2);
const filtered3 = visibleCharactersRecord(table, { showAllCharacters: false, performCharacterId: 'c' });
check('2.6 换操控角色 → 重算为新可见集',
  !!filtered3 && filtered3 !== filtered1 && ids(Object.values(filtered3)) === 'c');
const table2: Record<string, Ch> = { a: A, b: B, c: C };
const filtered4 = visibleCharactersRecord(table2, { showAllCharacters: false, performCharacterId: 'c' });
check('2.7 换表同一性 → 重算（不复用旧记忆）',
  !!filtered4 && filtered4 !== filtered3 && ids(Object.values(filtered4)) === 'c');
check('2.8 undefined 表 → undefined 直传',
  visibleCharactersRecord(undefined, { showAllCharacters: false, performCharacterId: 'b' }) === undefined);

// ---------- 3) 源码接线断言 ----------
const pixelCanvas = readFileSync(join(root, 'src/components/pixel-editor/PixelCanvas.tsx'), 'utf8');
const canvasState = readFileSync(join(root, 'src/components/pixel-editor/canvas/use-canvas-state.ts'), 'utf8');

check('3.1 PixelCanvas 主渲染的角色表来自 visibleCharactersRecord',
  /const unifiedCharacters = visibleCharactersRecord\(useProjectStore\.getState\(\)\.unifiedCharacters, puppetSession\)/.test(pixelCanvas));
check('3.2 beginPickFrame 消费同一份 unifiedCharacters（拾取与主画布同集）',
  /beginPickFrame\(\{\s*characters: unifiedCharacters,/.test(pixelCanvas));
check('3.3 renderUnified 消费同一份 unifiedCharacters',
  /unifiedCharacters, animationClips, true, globalBlueprint/.test(pixelCanvas));
check('3.4 PixelCanvas 不再本地定义 filterVisibleCharacters（口径单出处）',
  !/function filterVisibleCharacters/.test(pixelCanvas) && pixelCanvas.includes("from '@/lib/visible-characters'"));
check('3.5 洋葱皮收敛到同一过滤函数（旧内联 matched 过滤已除）',
  pixelCanvas.includes('filterVisibleCharacters(allCharacters, session)') && !/const matched = allCharacters\.filter/.test(pixelCanvas));
check('3.6 骨骼覆盖层按可见集传 characters',
  /characters: filterVisibleCharacters\(charList, usePuppetSessionStore\.getState\(\)\)/.test(pixelCanvas));
check('3.7 拾取读侧期望戳记用可见集（与绘制侧同源同物）',
  /const visibleRecord = visibleCharactersRecord\(state\.unifiedCharacters, usePuppetSessionStore\.getState\(\)\)/.test(canvasState)
  && /characters: visibleRecord, sprites: state\.sprites/.test(canvasState));
check('3.8 几何兜底 pickNodesAt 只迭代可见集（隐藏角色点不中）',
  canvasState.includes('pickNodesAt(Object.values(visibleRecord ?? {})')
  && !canvasState.includes('pickNodesAt(Object.values(state.unifiedCharacters)'));

console.log(`\n合计：${passed} 过 / ${failed} 败`);
process.exit(failed > 0 ? 1 : 0);
