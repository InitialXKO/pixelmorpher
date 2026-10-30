// 程序化位姿增量验收探针（程序化页签审计缺陷 1+2 修复）
// 覆盖：
//  A) computeProceduralPoseDelta 汇总口径——平移按 px 累加、旋转按度
//     累加、缩放逐条 max(0.1, 1+v/10) 累乘（与播放器 paScale 同式）
//  B) 门控三态——未启用/帧外/缺对应启用修改器 → 零增量；齐备 → 非零；
//     帧界含端点；nodeId 不匹配/缺失不串扰；spriteId-only 条目永不命中
//  C) 取值同源对拍——引擎 computeProceduralValue 与播放器
//     dynProceduralValue（createDynamicRuntime）逐帧同值，且增量按
//     播放器公式由 dyn 值组装的结果与 A 一致
//  D) 源码级断言——unified-render 不再以 applyProceduralAnimations 改
//     指令 modifiers；ProceduralPanel 不再含本地 computeProceduralValue
//     /pseudoNoise 且 import 引擎函数；精灵模式警示与禁用添加在位
import { computeProceduralPoseDelta, computeProceduralValue } from '../src/lib/engine/procedural';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';
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
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5)], mods, undefined, 1)), 'nodeId 入参缺失 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { nodeId: undefined, spriteId: 's9' })], mods, 'n1', 1)), 'spriteId-only 条目 → 永不命中节点');
  ok(isZeroDelta(computeProceduralPoseDelta([], mods, 'n1', 1)), '空列表 → 零增量');
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

  const panel = readFileSync(new URL('../src/components/pixel-editor/ProceduralPanel.tsx', import.meta.url), 'utf8');
  ok(!panel.includes('function computeProceduralValue'), 'ProceduralPanel 不再含本地 computeProceduralValue 定义');
  ok(!panel.includes('pseudoNoise'), 'ProceduralPanel 不再含 pseudoNoise');
  ok(panel.includes("import { computeProceduralValue } from '@/lib/engine/procedural'"), 'ProceduralPanel 改 import 引擎 computeProceduralValue');
  ok(panel.includes('SPRITE_ONLY_NOTE') && panel.includes('只有精灵目标的条目在编辑器与导出中均不生效'), '精灵模式警示文案在位');
  ok(panel.includes('disabled={!nodeMode}'), '精灵模式下添加下拉禁用');

  const eng = readFileSync(new URL('../src/lib/engine/procedural.ts', import.meta.url), 'utf8');
  ok(eng.includes('export function applyProceduralAnimations'), 'applyProceduralAnimations 本体保留（convert 注释引用其查找规则）');
  ok(eng.includes('export function computeProceduralPoseDelta'), 'computeProceduralPoseDelta 已导出');
}

console.log(`\nverify-procedural-pose-delta: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
