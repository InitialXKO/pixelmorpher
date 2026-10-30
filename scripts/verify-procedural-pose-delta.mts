// 程序化位姿增量验收探针（程序化页签审计缺陷 1+2 修复 + 精灵目标
// 自动落到挂载节点）
// 覆盖：
//  A) computeProceduralPoseDelta 汇总口径——平移按 px 累加、旋转按度
//     累加、缩放逐条 max(0.1, 1+v/10) 累乘（与播放器 paScale 同式）
//  B) 门控三态——未启用/帧外/缺对应启用修改器 → 零增量；齐备 → 非零；
//     帧界含端点；nodeId 不匹配不串扰；精灵通道——spriteId 命中节点
//     当前解析精灵（resolvedSpriteId）才出增量、不符/缺省不出、双通
//     道同命中只计一次、精灵通道同受门控
//  C) 取值同源对拍——引擎 computeProceduralValue 与播放器
//     dynProceduralValue（createDynamicRuntime）逐帧同值，且增量按
//     播放器公式由 dyn 值组装的结果与 A 一致
//  D) 源码级断言——unified-render 不再以 applyProceduralAnimations 改
//     指令 modifiers；ProceduralPanel 不再含本地 computeProceduralValue
//     /pseudoNoise 且 import 引擎函数；上一轮「堵死精灵目标新建」的
//     警示与禁用已撤销（SPRITE_ONLY_NOTE 与添加禁用不存在）、精灵目
//     标可新建且选中节点时列表含挂载精灵条目；convert 不再以「只有
//     spriteId」点名丢弃、改走挂载解析
//  E) convert 构造对拍——只有 spriteId 的条目按挂载关系进包（一精
//     灵多节点多条）、未被任何节点挂载的点名丢弃、挂载节点缺对应
//     修改器的点名不进包、nodeId 条目原路径不变
import { computeProceduralPoseDelta, computeProceduralValue } from '../src/lib/engine/procedural';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { pxToSub, type Character as UnifiedCharacter, type Node as UnifiedNode } from '../src/lib/unified-types';
import type { ModifierInstance, ProceduralAnimation, ProceduralConfig } from '../src/lib/types';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const isZeroDelta = (d: { dx: number; dy: number; rotDeg: number; scaleMul: number }) =>
  d.dx === 0 && d.dy === 0 && d.rotDeg === 0 && d.scaleMul === 1;

// ---- 夹具 ----
let seq = 0;
const mod = (type: ModifierInstance['type'], enabled = true): ModifierInstance => ({
  id: `m${++seq}`,
  type,
  enabled,
  collapsed: false,
  params: {},
  startFrame: -1,
  endFrame: -1,
  fadeInFrames: 0,
  fadeOutFrames: 0,
});
const pa = (config: ProceduralConfig, over: Partial<ProceduralAnimation> = {}): ProceduralAnimation => ({
  id: `pa${++seq}`,
  name: 't',
  spriteId: '',
  nodeId: 'n1',
  config,
  enabled: true,
  startFrame: 0,
  endFrame: 100,
  ...over,
});
const waveX = (amplitude: number, over: Partial<ProceduralAnimation> = {}) =>
  pa({ type: 'wave', amplitude, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'translateX' }, over);
// wave sine: frame=1 → t=0.25 → sin(2πt)=+1 → v=+amplitude；frame=3 → t=0.75 → v=−amplitude

console.log('A) 汇总口径');
{
  const mods = [mod('translate'), mod('rotate'), mod('uniform_scale')];
  // 平移累加：+5 与 −3 两条同帧叠加 → dx=2
  const d1 = computeProceduralPoseDelta([waveX(5), waveX(3, { config: { type: 'wave', amplitude: 3, frequency: 0.25, phase: 180, waveType: 'sine', targetProperty: 'translateX' } })], mods, 'n1', 1);
  ok(near(d1.dx, 2), `translateX 两条累加 dx=2（实 ${d1.dx}）`);
  ok(d1.dy === 0 && d1.rotDeg === 0 && d1.scaleMul === 1, 'translateX 不串扰其余通道');

  // translateY 走 dy、由引擎取值原样透传（noise 无闭式，用引擎值对拍）
  const noiseCfg: ProceduralConfig = { type: 'noise', amplitude: 7, frequency: 0.05, octaves: 3, seed: 42, targetProperty: 'translateY' };
  const d2 = computeProceduralPoseDelta([pa(noiseCfg)], mods, 'n1', 17);
  ok(near(d2.dy, computeProceduralValue(noiseCfg, 17)) && d2.dx === 0, 'translateY 透传引擎取值到 dy');

  // 旋转按度累加：两条同值叠加
  const rotCfg: ProceduralConfig = { type: 'wave', amplitude: 30, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'rotation' };
  const d3 = computeProceduralPoseDelta([pa(rotCfg), pa(rotCfg)], mods, 'n1', 1);
  ok(near(d3.rotDeg, 60), `rotation 两条累加 rotDeg=60（实 ${d3.rotDeg}）`);

  // 缩放累乘：v=+5 → ×1.5；v=−50 → 1+(−5)=−4 钳 0.1 → 总 ×0.15
  const scaleCfg = (amplitude: number, phase: number): ProceduralConfig =>
    ({ type: 'wave', amplitude, frequency: 0.25, phase, waveType: 'sine', targetProperty: 'scale' });
  const d4 = computeProceduralPoseDelta([pa(scaleCfg(5, 0)), pa(scaleCfg(50, 180))], mods, 'n1', 1);
  ok(near(d4.scaleMul, 0.15), `scale 累乘含钳制 scaleMul=0.15（实 ${d4.scaleMul}）`);
  const d5 = computeProceduralPoseDelta([pa(scaleCfg(50, 180))], mods, 'n1', 1);
  ok(near(d5.scaleMul, 0.1), 'scale 单条深负值钳到 0.1');
  const d6 = computeProceduralPoseDelta([pa(scaleCfg(5, 0))], mods, 'n1', 1);
  ok(near(d6.scaleMul, 1.5), 'scale 单条正值 ×1.5');
}

console.log('B) 门控三态');
{
  const mods = [mod('translate'), mod('rotate'), mod('uniform_scale')];
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { enabled: false })], mods, 'n1', 1)), '未启用条目 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5)], mods, 'n1', 101)), '帧在 endFrame 外 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { startFrame: 10 })], mods, 'n1', 1)), '帧在 startFrame 前 → 零增量');
  ok(!isZeroDelta(computeProceduralPoseDelta([waveX(5, { startFrame: 1, endFrame: 1 })], mods, 'n1', 1)), '帧界端点（含）→ 非零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5)], [mod('rotate'), mod('uniform_scale')], 'n1', 1)), '缺 translate 修改器 → translateX 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5)], [mod('translate', false)], 'n1', 1)), 'translate 修改器禁用 → 零增量');
  const rotCfg: ProceduralConfig = { type: 'wave', amplitude: 30, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'rotation' };
  ok(isZeroDelta(computeProceduralPoseDelta([pa(rotCfg)], [mod('translate'), mod('uniform_scale')], 'n1', 1)), '缺 rotate 修改器 → rotation 零增量');
  const scaleCfg: ProceduralConfig = { type: 'wave', amplitude: 5, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'scale' };
  ok(isZeroDelta(computeProceduralPoseDelta([pa(scaleCfg)], [mod('translate'), mod('rotate')], 'n1', 1)), '缺 uniform_scale 修改器 → scale 零增量');
  // 混合：同一节点上 rotation 缺门时不影响 translateX 命中
  const mixed = computeProceduralPoseDelta([waveX(5), pa(rotCfg)], [mod('translate')], 'n1', 1);
  ok(near(mixed.dx, 5) && mixed.rotDeg === 0, '门控逐属性独立：translate 命中、rotation 被门');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { nodeId: 'n2' })], mods, 'n1', 1)), 'nodeId 不匹配 → 不串扰');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5)], mods, undefined, 1)), 'nodeId 入参缺失且无解析精灵 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([], mods, 'n1', 1)), '空列表 → 零增量');

  // 精灵通道：只挂精灵的条目落到「当前解析精灵正是它」的节点上
  const spritePa = waveX(5, { nodeId: undefined, spriteId: 's9' });
  const hitSprite = computeProceduralPoseDelta([spritePa], mods, 'n1', 1, 's9');
  ok(near(hitSprite.dx, 5), `spriteId 命中解析精灵 → 出增量 dx=5（实 ${hitSprite.dx}）`);
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], mods, 'n1', 1, 'sX')), 'spriteId 与解析精灵不符 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], mods, 'n1', 1)), '未传解析精灵 → 精灵通道不命中');
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], mods, 'n1', 1, '')), '解析精灵为空串 → 精灵通道不命中');
  const hitNoNodeArg = computeProceduralPoseDelta([spritePa], mods, undefined, 1, 's9');
  ok(near(hitNoNodeArg.dx, 5), 'nodeId 入参缺失时精灵通道仍可命中');
  // 双通道同命中只计一次（nodeId 与 spriteId 指向同一节点同一条）
  const bothPa = waveX(5, { nodeId: 'n1', spriteId: 's9' });
  const bothHit = computeProceduralPoseDelta([bothPa], mods, 'n1', 1, 's9');
  ok(near(bothHit.dx, 5), `双通道同命中只计一次 dx=5（实 ${bothHit.dx}）`);
  // 精灵通道同受门控：缺修改器/未启用/帧外都不出
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], [mod('rotate')], 'n1', 1, 's9')), '精灵通道：缺 translate 修改器 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { nodeId: undefined, spriteId: 's9', enabled: false })], mods, 'n1', 1, 's9')), '精灵通道：未启用 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], mods, 'n1', 101, 's9')), '精灵通道：帧外 → 零增量');
}

console.log('C) 与播放器同式对拍');
{
  const rt = createDynamicRuntime();
  const dyn = (cfg: ProceduralConfig, f: number) => rt.dynProceduralValue(cfg as never, f);
  const cfgs: ProceduralConfig[] = [
    { type: 'noise', amplitude: 7, frequency: 0.05, octaves: 3, seed: 42, targetProperty: 'translateX' },
    { type: 'wave', amplitude: 9, frequency: 0.3, phase: 40, waveType: 'sine', targetProperty: 'translateX' },
    { type: 'wave', amplitude: 9, frequency: 0.3, phase: 40, waveType: 'triangle', targetProperty: 'translateX' },
    { type: 'wave', amplitude: 9, frequency: 0.3, phase: 40, waveType: 'square', targetProperty: 'translateX' },
    { type: 'wave', amplitude: 9, frequency: 0.3, phase: 40, waveType: 'sawtooth', targetProperty: 'translateX' },
    { type: 'spring', stiffness: 0.8, damping: 0.25, mass: 1.5, restLength: 4, targetProperty: 'translateX' },
    { type: 'jitter', amount: 3, frequency: 0.7, smooth: true, targetProperty: 'translateX' },
    { type: 'jitter', amount: 3, frequency: 0.7, smooth: false, targetProperty: 'translateX' },
  ];
  const frames = [0, 1, 3, 17, 42, 99];
  let allSame = true;
  for (const cfg of cfgs) {
    for (const f of frames) {
      if (!near(computeProceduralValue(cfg, f), dyn(cfg, f))) {
        allSame = false;
        console.log(`    值不一致: ${cfg.type} frame=${f} engine=${computeProceduralValue(cfg, f)} dyn=${dyn(cfg, f)}`);
      }
    }
  }
  ok(allSame, '引擎取值与播放器 dynProceduralValue 四类八式逐帧同值');

  // 增量按播放器公式由 dyn 值组装 == computeProceduralPoseDelta（引擎值）
  const mods = [mod('translate'), mod('rotate'), mod('uniform_scale')];
  for (const cfg of cfgs) {
    for (const f of [1, 17, 42]) {
      const v = dyn(cfg, f);
      const asX = computeProceduralPoseDelta([pa({ ...cfg, targetProperty: 'translateX' })], mods, 'n1', f);
      const asRot = computeProceduralPoseDelta([pa({ ...cfg, targetProperty: 'rotation' })], mods, 'n1', f);
      const asScale = computeProceduralPoseDelta([pa({ ...cfg, targetProperty: 'scale' })], mods, 'n1', f);
      ok(near(asX.dx, v) && near(asRot.rotDeg, v) && near(asScale.scaleMul, Math.max(0.1, 1 + v / 10)),
        `${cfg.type} frame=${f} 增量与播放器公式同式（v=${v.toFixed(4)}）`);
    }
  }
}

console.log('D) 源码级断言');
{
  const ur = readFileSync(new URL('../src/lib/unified-render.ts', import.meta.url), 'utf8');
  ok(!ur.includes('applyProceduralAnimations'), 'unified-render 不再引用 applyProceduralAnimations（旧调用串消失）');
  ok(ur.includes('computeProceduralPoseDelta(proceduralAnimations'), 'unified-render 改走 computeProceduralPoseDelta 汇总位姿增量');
  ok(ur.includes('pxToSub(procDelta.dx)') && ur.includes('pxToSub(procDelta.dy)'), '平移增量叠进 worldX/worldY（pxToSub 同 folDx 口径）');
  ok(ur.includes('+ procDelta.rotDeg'), '旋转增量叠进 angle');
  ok(ur.includes('modifiers: node.modifiers'), '指令 modifiers 回归节点原始修改器（不再被程序化改写）');

  ok(ur.includes('nodeSpriteId ?? undefined'), 'unified-render 把本次解析出的精灵 id 传给增量汇总');

  const panel = readFileSync(new URL('../src/components/pixel-editor/ProceduralPanel.tsx', import.meta.url), 'utf8');
  ok(!panel.includes('function computeProceduralValue'), 'ProceduralPanel 不再含本地 computeProceduralValue 定义');
  ok(!panel.includes('pseudoNoise'), 'ProceduralPanel 不再含 pseudoNoise');
  ok(panel.includes("import { computeProceduralValue } from '@/lib/engine/procedural'"), 'ProceduralPanel 改 import 引擎 computeProceduralValue');
  ok(!panel.includes('SPRITE_ONLY_NOTE'), '上一轮的精灵目标警示（SPRITE_ONLY_NOTE）已撤销');
  ok(!panel.includes('disabled={!nodeMode}'), '添加下拉不再按有无节点禁用（只挂精灵也可新建）');
  ok(panel.includes('nodeSpriteIds'), '选中节点时列表按挂载精灵集合并入精灵目标条目');

  const eng = readFileSync(new URL('../src/lib/engine/procedural.ts', import.meta.url), 'utf8');
  ok(eng.includes('export function applyProceduralAnimations'), 'applyProceduralAnimations 本体保留（convert 注释引用其查找规则）');
  ok(eng.includes('export function computeProceduralPoseDelta'), 'computeProceduralPoseDelta 已导出');
  ok(eng.includes('matchesSprite'), '引擎含精灵通道匹配（resolvedSpriteId）');

  const conv = readFileSync(new URL('../src/lib/proc-runtime/convert.ts', import.meta.url), 'utf8');
  ok(!conv.includes('只有 spriteId 无 nodeId'), 'convert 不再以「只有 spriteId 无 nodeId」点名丢弃');
  ok(conv.includes('mountNodesOf') && conv.includes('目标精灵未被任何节点挂载'), 'convert 改按挂载关系解析精灵目标、无挂载时点名');
}

console.log('E) convert 挂载解析对拍');
{
  const grid = [['#ffffff', '#ffffff'], ['#ffffff', '#ffffff']];
  const mkNode = (id: string, slotKey: string | null, mods: unknown[], parentId?: string): UnifiedNode => ({
    id, name: id, parentId,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [],
    tracks: {},
    modifiers: mods,
    children: [],
    sprite: undefined as never,
  } as unknown as UnifiedNode);
  const tMod = [{ id: 'tm', type: 'translate', enabled: true, collapsed: false, params: {}, startFrame: -1, endFrame: -1, fadeInFrames: 0, fadeOutFrames: 0 }];
  const root = mkNode('root', null, []);
  const armL = mkNode('armL', 'armL', tMod, 'root');
  const armR = mkNode('armR', 'armR', tMod, 'root');
  const armX = mkNode('armX', 'armX', [], 'root');
  root.children = ['armL', 'armR', 'armX'];
  (armL.transform as { x: number }).x = pxToSub(-20);
  (armR.transform as { x: number }).x = pxToSub(20);
  const char = {
    id: 'cp1', name: '程序化挂载测试',
    nodes: { root, armL, armR, armX },
    rootNodeId: 'root',
    rootNodeIds: ['root'],
    sprites: {
      sprA: { id: 'sprA', width: 2, height: 2, data: grid },
      sprB: { id: 'sprB', width: 2, height: 2, data: grid },
    },
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: {
        armL: { sprites: { 2: { spriteId: 'sprA' } } },
        armR: { sprites: { 6: { spriteId: 'sprA' } } },
        armX: { sprites: { 2: { spriteId: 'sprB' } } },
      },
    }],
    activeCostumeSetId: 'set1',
    variants: { '0': '东', '2': '西' },
  } as unknown as UnifiedCharacter;

  const cfgX: ProceduralConfig = { type: 'wave', amplitude: 5, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'translateX' };
  const pas: ProceduralAnimation[] = [
    { id: 'e1', name: '精灵目标', spriteId: 'sprA', config: cfgX, enabled: true, startFrame: 0, endFrame: 100 },
    { id: 'e2', name: '无挂载', spriteId: 'sprGhost', config: cfgX, enabled: true, startFrame: 0, endFrame: 100 },
    { id: 'e3', name: '缺修改器', spriteId: 'sprB', config: cfgX, enabled: true, startFrame: 0, endFrame: 100 },
    { id: 'e4', name: '节点目标', spriteId: '', nodeId: 'armL', config: cfgX, enabled: true, startFrame: 0, endFrame: 100 },
  ];
  const pkg = convertCharacterToRuntimePackage(char, undefined, { projectData: { proceduralAnimations: pas } });
  const entries = pkg.procedural ?? [];
  ok(entries.filter((e) => e.slot === 'armR').length === 1, '精灵目标落到第二个挂载节点 armR（一条）');
  ok(entries.filter((e) => e.slot === 'armL').length === 2, 'armL 吃到精灵目标 + 节点目标（两条）');
  ok(entries.every((e) => e.slot !== 'armX'), '缺修改器的挂载节点 armX 不进包');
  ok(entries.length === 3, `进包共 3 条（实 ${entries.length}）`);
  ok(pkg.warnings.some((w) => w.includes('无挂载') && w.includes('未被任何节点挂载')), '未被任何节点挂载的精灵条目被点名丢弃');
  ok(pkg.warnings.some((w) => w.includes('缺修改器') && w.includes('均无启用的')), '挂载节点均无对应修改器的精灵条目被点名不进包');
}

console.log(`\nverify-procedural-pose-delta: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
