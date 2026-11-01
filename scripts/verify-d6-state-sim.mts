/**
 * D6 流体一期探针：包内有状态粒子模拟（runtimeSim）。
 *
 * A) 参数面：runtimeSim 缺省 false、规范化只认真 true、
 *    createDynamicInstance 透传。
 * B) convert 标记：runtimeSim=true 的实例进包带 stateSim: true、
 *    false 的不带（缺省形态）；运行时 HTML 含模拟器且脚本可解析；
 *    模板三处生命周期全清钩子 + 绘制点按 inst.stateSim 分流。
 * C) 行为：从 runtime-template.ts 抽状态模拟段真源码 + DYNAMIC_SRC
 *    驱动——同种子双跑逐帧一致、烟涡场横向位移显著（对流存在）、
 *    地面落定、火→烟转换计数、seek 重置清空。
 *
 * 运行：bun scripts/verify-d6-state-sim.mts
 */
import { readFileSync } from 'node:fs';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';
import { DYNAMIC_SRC } from '../src/lib/proc-runtime/dynamic-src';
import {
  createDynamicInstance, defaultDynamicParams, normalizeDynamicParams,
} from '../src/lib/dynamic-patterns';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { createDefaultCostumePiece, pxToSub } from '../src/lib/unified-types';
import type { Character, UnifiedNode } from '../src/lib/unified-types';

let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// ---------- A) 参数面 ----------
{
  check('A1 runtimeSim 缺省 false', defaultDynamicParams().runtimeSim === false);
  check('A2 规范化只认真 true',
    normalizeDynamicParams({ runtimeSim: true }).runtimeSim === true
    && normalizeDynamicParams({ runtimeSim: 'yes' as never }).runtimeSim === false
    && normalizeDynamicParams({}).runtimeSim === false);
  const inst = createDynamicInstance('烟', { ...defaultDynamicParams(), runtimeSim: true }, '氛围');
  check('A3 createDynamicInstance 透传 runtimeSim', inst.params.runtimeSim === true);
}

// ---------- B) convert 标记 + HTML ----------
function makeNode(id: string, name: string, slotKey: string | null, parentId?: string): UnifiedNode {
  return {
    id, name, parentId,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [], tracks: {}, modifiers: [], children: [],
    sprite: undefined as never,
  } as unknown as UnifiedNode;
}
{
  const grid5: (string | null)[][] = Array.from({ length: 5 }, () => Array(5).fill('#3366aa'));
  const sprite5 = { width: 5, height: 5, data: grid5, plug: { x: pxToSub(1), y: pxToSub(2) } };
  const torsoPiece = createDefaultCostumePiece('torso');
  torsoPiece.parametric = { ...createDefaultParametricAppearance(), composite: 'overlay', haloWidth: 2 } as never;
  (torsoPiece.sprites as Record<number, unknown>)[2] = sprite5;
  const simParams = { ...defaultDynamicParams(), runtimeSim: true, rate: 30 };
  const closedParams = { ...defaultDynamicParams(), rate: 31 };
  const ch = {
    id: 'chD6', name: '状态模拟',
    nodes: {
      torso: {
        ...makeNode('torso', '躯干', 'torso'),
        dynamicPatterns: [
          createDynamicInstance('烟', simParams, '氛围'),
          createDynamicInstance('闭式', closedParams, '身体'),
        ],
      },
    },
    rootNodeId: 'torso',
    rootNodeIds: ['torso'],
    costumeSets: [{ id: 'set1', name: '默认', pieces: { torso: torsoPiece } }],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;

  const pkg = convertCharacterToRuntimePackage(ch);
  const dyn = pkg.parts.find((p) => p.key === 'torso')?.dynamic ?? [];
  check('B1 两实例都进包', dyn.length === 2, `n=${dyn.length}`);
  check('B2 runtimeSim=true 实例带 stateSim 标记', dyn[0]?.stateSim === true && dyn[0]?.params.runtimeSim === true);
  check('B3 runtimeSim=false 实例无 stateSim 字段（缺省形态）',
    dyn.length === 2 && !('stateSim' in (dyn[1] as object)));

  const html = buildRuntimeHtml(pkg);
  check('B4 HTML 含状态模拟器', html.includes('stateSimAdvance') && html.includes('stateSimField'));
  let parseOk = true;
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { new Function(m[1]); } catch { parseOk = false; }
  }
  check('B5 HTML 全部 script 可解析', parseOk);

  const tplSrc = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
  check('B6 三处生命周期全清钩子（录制/回放/硬重锁）',
    (tplSrc.match(/stateSimPools\.clear\(\)/g) ?? []).length >= 3);
  check('B7 绘制点按 inst.stateSim 分流、闭式路径保留',
    tplSrc.includes('inst.stateSim ? stateSimParticlesFor') && tplSrc.includes('dynSimulate(inst,'));
  check('B8 存活清扫（实例消失删池）', tplSrc.includes('stateSimSeen') && tplSrc.includes('stateSimPools.delete(k)'));
}

// ---------- C) 行为：抽真源码驱动 ----------
interface PoolP { x: number; y: number; sx: number; sy: number; kind: number; resting: boolean; age: number }
interface Pool { t: number; list: PoolP[]; converted: number; spawned: number }
interface SimRt {
  stateSimPools: Map<string, Pool>;
  stateSimAdvance: (key: string, inst: never, tile: never, seedKey: string, elapsed: number) => Pool;
  stateSimDraw: (pool: Pool, layer: string) => { x: number; y: number; shape: string; alpha: number }[];
}
const tplSrc = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
const secStart = tplSrc.indexOf('// ---- 粒子实时模拟（运行时，D6 流体一期）');
const secEnd = tplSrc.indexOf('// ---------- 默认动作表演兜底', secStart);
check('C0 状态模拟段可抽取', secStart >= 0 && secEnd > secStart);
const section = tplSrc.slice(secStart, secEnd);
const rt = new Function(`${DYNAMIC_SRC}\n${section}\nreturn { stateSimPools, stateSimAdvance, stateSimDraw };`)() as SimRt;

const tileData = new Uint8Array(24 * 24 * 4).fill(255);
const tile = { data: tileData, w: 24, h: 24, cx: 12, cy: 12 } as never;
function mkInst(params: Record<string, unknown>, id = 'dyn_p1') {
  return { id, slot: '氛围', stateSim: true, params: { ...defaultDynamicParams(), ...params } } as never;
}
function runSeq(inst: never, seconds: number, key = 'torso|dyn_p1') {
  rt.stateSimPools.clear();
  let pool = rt.stateSimAdvance(key, inst, tile, 'torso', 0);
  const snaps: string[] = [];
  const frames = Math.round(seconds * 60);
  for (let f = 1; f <= frames; f++) {
    pool = rt.stateSimAdvance(key, inst, tile, 'torso', f / 60);
    if (f % 30 === 0) snaps.push(JSON.stringify(rt.stateSimDraw(pool, 'front')));
  }
  return { pool, snaps };
}

{ // C1 确定性：同种子、同 elapsed 序列双跑逐帧一致
  const inst = mkInst({ rate: 60, life: 3, particleShape: 'puff', directionDeg: -90, speed: 10, spreadDeg: 0, source: 'plug', buoy: 20, maxParticles: 400, layer: 'front' });
  const a = runSeq(inst, 2.5);
  const b = runSeq(inst, 2.5);
  check('C1 同种子双跑逐帧绘制一致', JSON.stringify(a.snaps) === JSON.stringify(b.snaps)
    && a.pool.converted === b.pool.converted && a.pool.spawned === b.pool.spawned,
    `spawned ${a.pool.spawned}/${b.pool.spawned}`);
  check('C1b 池内确有存活粒子', a.pool.list.length > 10, `n=${a.pool.list.length}`);
}
{ // C2 烟雾对流：plug 源 + 零扩散 → 出生初速纯竖直，横向位移只能来自涡场
  const inst = mkInst({ rate: 60, life: 3, particleShape: 'puff', directionDeg: -90, speed: 10, spreadDeg: 0, source: 'plug', buoy: 20, maxParticles: 400, layer: 'front' });
  const { pool } = runSeq(inst, 2.5);
  const old = pool.list.filter((p) => p.kind === 2 && p.age > 0.8);
  const meanDx = old.reduce((s, p) => s + Math.abs(p.x - p.sx), 0) / Math.max(1, old.length);
  const maxDx = old.reduce((s, p) => Math.max(s, Math.abs(p.x - p.sx)), 0);
  check('C2 烟粒子横向位移显著非零（涡场对流）', old.length > 5 && meanDx > 1.0 && maxDx > 3,
    `n=${old.length} mean|dx|=${meanDx.toFixed(2)} max=${maxDx.toFixed(2)}`);
}
{ // C3 地面落定：下射弹道粒子（kind 0）落到 groundYPx 线并停住
  const inst = mkInst({ rate: 40, life: 6, particleShape: 'dot', directionDeg: 90, speed: 30, spreadDeg: 0, source: 'plug', buoy: 0, rise: 0, maxParticles: 300, layer: 'front', groundYPx: 8 } as Record<string, unknown>);
  const { pool } = runSeq(inst, 3);
  const resting = pool.list.filter((p) => p.resting);
  check('C3 有粒子落定且恰停在地面线', resting.length >= 2 && resting.every((p) => p.y === 8),
    `resting=${resting.length}`);
}
{ // C4 火→烟转换：dot 出生含火粒子，龄比过半转烟并计数，绘制出 puff
  const inst = mkInst({ rate: 80, life: 2, particleShape: 'dot', directionDeg: -90, speed: 16, spreadDeg: 10, source: 'plug', buoy: 30, maxParticles: 400, layer: 'front' });
  const { pool } = runSeq(inst, 2.5);
  const drawn = rt.stateSimDraw(pool, 'front');
  check('C4 火→烟转换计数 > 0', pool.converted > 0, `converted=${pool.converted}`);
  check('C4b 转换后绘制含 puff 软盘', drawn.some((d) => d.shape === 'puff'));
}
{ // C5 seek 重置：elapsed 回退 → 池清空从当前点重滚；大步跳变同理
  const inst = mkInst({ rate: 60, life: 3, particleShape: 'puff', directionDeg: -90, speed: 10, source: 'plug', layer: 'front' });
  const { pool } = runSeq(inst, 2);
  const before = pool.list.length;
  const back = rt.stateSimAdvance('torso|dyn_p1', inst, tile, 'torso', 0.2);
  check('C5 回退 seek 后池清空', before > 0 && back.list.length === 0 && back.t === 0.2, `before=${before}`);
  rt.stateSimAdvance('torso|dyn_p1', inst, tile, 'torso', 0.25);
  const fwd = rt.stateSimAdvance('torso|dyn_p1', inst, tile, 'torso', 3.0);
  check('C5b 前跳超阈值重置', fwd.list.length === 0 && fwd.t === 3.0);
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
