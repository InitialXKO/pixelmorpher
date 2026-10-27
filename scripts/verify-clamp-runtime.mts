// 钳制锚定运行时探针：
// A) 发包校验——带 anchor 点标记的精灵部件经 convert 进包、标记随
//    服装条目入包；生成的页面脚本可解析且含锚定遍。
// B) 行为——从模板源码抽出锚定遍本体（非抄写），以桩全局驱动：
//    侧视贴顶冻结/身体反向横移/回写物理/走出释放/俯视区域/硬优先。
import { readFileSync } from 'node:fs';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';
import {
  createDefaultCostumePiece, pxToSub,
  type Character, type Node as UnifiedNode, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const check = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------- A) 发包 ----------
function makeNode(id: string, name: string, slotKey: string | null, parentId?: string): UnifiedNode {
  return {
    id, name, parentId, role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children: [],
    sprite: undefined as never,
  } as unknown as UnifiedNode;
}
{
  const grid: (string | null)[][] = Array.from({ length: 10 }, () => Array(10).fill('#996633'));
  const spr: Sprite = {
    id: 'spr_foot', name: '脚', width: 10, height: 10, data: grid,
    plug: { x: pxToSub(5), y: pxToSub(2) },
    marks: [{ id: 'mk1', name: 'anchor', kind: 'point', x: 0.5, y: 0.9 }],
  } as unknown as Sprite;
  const torso = makeNode('torso', '躯干', 'torso');
  const foot = makeNode('foot', '脚', 'foot', 'torso');
  torso.children = ['foot'];
  const pieceT = { ...createDefaultCostumePiece('torso'), parametric: undefined } as never;
  const pieceF = createDefaultCostumePiece('foot');
  pieceF.sprites = { 2: { spriteId: 'spr_foot' } } as never;
  const ch = {
    id: 'cr1', name: '运行时钳制测试',
    nodes: { torso, foot }, rootNodeId: 'torso', rootNodeIds: ['torso'],
    sprites: { spr_foot: spr },
    costumeSets: [{ id: 'set1', name: '默认', pieces: { torso: pieceT, foot: pieceF } }],
    activeCostumeSetId: 'set1',
    variants: { '0': '东', '2': '西' },
  } as unknown as Character;
  const pkg = convertCharacterToRuntimePackage(ch, undefined, {
    projectData: { scene: { solids: [{ x: -60, y: 0, w: 120, h: 20 }] } },
  } as never);
  const pkgJson = JSON.stringify(pkg);
  check(pkgJson.includes('"anchor"'), 'A1 包内含 anchor 标记（随精灵/服装条目入包，约定纳入）');
  check(Array.isArray((pkg as { scene?: { solids?: unknown[] } }).scene?.solids)
    && ((pkg as { scene: { solids: unknown[] } }).scene.solids.length === 1), 'A2 场景固体进包');
  const html = buildRuntimeHtml(pkg);
  check(html.includes('runAnchorPass'), 'A3 生成页含锚定遍');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let parseOk = true;
  for (const sc of scripts) { try { new Function(sc); } catch { parseOk = false; } }
  check(parseOk && scripts.length > 0, 'A4 生成页脚本可解析（语法）');
}

// ---------- B) 锚定遍行为（模板源码抽出） ----------
{
  const src = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
  const i = src.indexOf('// ---- 钳制锚定（运行时');
  const j = src.indexOf('function charBoxH()');
  check(i > 0 && j > i, 'B0 模板含锚定段');
  const seg = src.slice(i, j);
  type Pt = [number, number];
  interface Cand { key: string; ctr: Pt; rot: number; dsx: number; dsy: number; local: Pt }
  const runPass = new Function('char', 'solids', 'moveMode', `
    const anchorState = new Map();
    ${seg.slice(seg.indexOf('function anchorPointWorld'))}
    return { runAnchorPass, anchorState };
  `) as (char: unknown, solids: unknown, moveMode: string) => {
    runAnchorPass: (c: Cand[], els: Array<{ pos: Pt }>, m: Map<string, { ctr: Pt }>) => void;
    anchorState: Map<string, { x: number; y: number }>;
  };
  const mkCand = (key: string, px: number, py: number): Cand => ({ key, ctr: [px, py], rot: 0, dsx: 1, dsy: 1, local: [0, 0] });

  // 侧视：平台顶 y=30（固体 y0 h30）
  {
    const char = { x: 0, y: 0, py: 0 };
    const solids = [{ x: -40, y: 0, w: 100, h: 30 }];
    const rt = runPass(char, solids, 'side');
    const anchorsByKey = new Map<string, { ctr: Pt }>();
    // f1：点穿入顶面 1 → 冻结到 (10, 30)，Δ=(0,+1) 回写
    const els1 = [{ pos: [0, 0] as Pt }];
    rt.runAnchorPass([mkCand('foot', 10, 29)], els1, anchorsByKey);
    check(near(char.y, 1) && near(els1[0].pos[1], 1), 'B1 侧视贴顶：冻结位=顶面、Δ 回写 char.y 且绘制位同步');
    // f2：宿主把点横推 +2、纵压 −2 → Δ=(−2,+2)：脚回冻结位、身体反向横移
    const els2 = [{ pos: [0, 0] as Pt }];
    rt.runAnchorPass([mkCand('foot', 12, 28)], els2, anchorsByKey);
    check(near(char.x, -2) && near(char.y, 3), `B2 脚不滑：身体反向横移抵消宿主横推（char=${char.x},${char.y}）`);
    // f3：点走出固体横向跨度 → 释放、无 Δ
    const x0 = char.x, y0 = char.y;
    rt.runAnchorPass([mkCand('foot', 200, 30)], [{ pos: [0, 0] as Pt }], anchorsByKey);
    check(char.x === x0 && char.y === y0 && !rt.anchorState.has('foot'), 'B3 走出跨度释放');
  }
  // 硬优先：两锚同帧生效，Δ 只认部件序第一
  {
    const char = { x: 0, y: 0, py: 0 };
    const solids = [{ x: -40, y: 0, w: 100, h: 30 }];
    const rt = runPass(char, solids, 'side');
    rt.runAnchorPass([mkCand('footA', 0, 29), mkCand('footB', 20, 25)], [{ pos: [0, 0] as Pt }], new Map());
    check(near(char.y, 1), 'B4 硬优先：Δ 由第一锚独占（+1，非两锚均分）');
  }
  // 俯视：点进区域冻结，宿主拖动由 Δ 回写 char.py 抵消
  {
    const char = { x: 0, y: 0, py: 0 };
    const solids = [{ x: 0, y: 0, w: 50, h: 50 }];
    const rt = runPass(char, solids, 'top');
    rt.runAnchorPass([mkCand('foot', 20, 20)], [{ pos: [0, 0] as Pt }], new Map());
    rt.runAnchorPass([mkCand('foot', 25, 23)], [{ pos: [0, 0] as Pt }], new Map());
    check(near(char.x, -5) && near(char.py, -3), `B5 俯视区域冻结：Δ 回写 char.x/char.py（${char.x},${char.py}）`);
  }
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
