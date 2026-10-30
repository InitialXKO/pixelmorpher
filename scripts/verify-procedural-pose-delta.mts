// 程序化位姿增量验收探针（程序化页签审计缺陷 1+2 修复 + 精灵目标
// 自动落到挂载节点）
// 覆盖：
//  A) computeProceduralPoseDelta 汇总口径——平移按 px 累加、旋转按度
//     累加、缩放逐条 max(0.1, 1+v/10) 累乘（与播放器 paScale 同式）
//  B) 计入条件——未启用/帧外 → 零增量；帧界含端点；不要求节点挂
//     修改器（门控已整体摘除）：命中即出增量；nodeId 不匹配不串
//     扰；精灵通道——spriteId 命中节点当前解析精灵
//     （resolvedSpriteId）才出增量、不符/缺省不出、双通道同命中只
//     计一次
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
//     灵多节点多条）、未被任何节点挂载的点名丢弃、挂载节点无修改
//     器也照样进包（门控已摘除）、nodeId 条目原路径不变
//  F) 弹簧与其余三类拉齐（加独立 amplitude、按帧推进、从条目起始
//     帧起振）——lf=0 取值、衰减包络、起始帧平移不变性、缺
//     amplitude 按 5 读、引擎与 dyn 两份弹簧带 startFrame 逐值对
//     拍；噪声输出居中（fbm 原语恒 [0,1)，分支 ×2−1 后跨零）；
//     wave/jitter 按改前公式在探针内复算、多帧多参数逐值不变
import { computeProceduralPoseDelta, computeProceduralValue } from '../src/lib/engine/procedural';
import { fbmNoise, seededRandom, simplex2D } from '../src/lib/engine/noise';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { pxToSub, type Character as UnifiedCharacter, type Node as UnifiedNode } from '../src/lib/unified-types';
import type { ProceduralAnimation, ProceduralConfig } from '../src/lib/types';
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
  // 平移累加：+5 与 −3 两条同帧叠加 → dx=2
  const d1 = computeProceduralPoseDelta([waveX(5), waveX(3, { config: { type: 'wave', amplitude: 3, frequency: 0.25, phase: 180, waveType: 'sine', targetProperty: 'translateX' } })], 'n1', 1);
  ok(near(d1.dx, 2), `translateX 两条累加 dx=2（实 ${d1.dx}）`);
  ok(d1.dy === 0 && d1.rotDeg === 0 && d1.scaleMul === 1, 'translateX 不串扰其余通道');

  // translateY 走 dy、由引擎取值原样透传（noise 无闭式，用引擎值对拍）
  const noiseCfg: ProceduralConfig = { type: 'noise', amplitude: 7, frequency: 0.05, octaves: 3, seed: 42, targetProperty: 'translateY' };
  const d2 = computeProceduralPoseDelta([pa(noiseCfg)], 'n1', 17);
  ok(near(d2.dy, computeProceduralValue(noiseCfg, 17)) && d2.dx === 0, 'translateY 透传引擎取值到 dy');

  // 旋转按度累加：两条同值叠加
  const rotCfg: ProceduralConfig = { type: 'wave', amplitude: 30, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'rotation' };
  const d3 = computeProceduralPoseDelta([pa(rotCfg), pa(rotCfg)], 'n1', 1);
  ok(near(d3.rotDeg, 60), `rotation 两条累加 rotDeg=60（实 ${d3.rotDeg}）`);

  // 缩放累乘：v=+5 → ×1.5；v=−50 → 1+(−5)=−4 钳 0.1 → 总 ×0.15
  const scaleCfg = (amplitude: number, phase: number): ProceduralConfig =>
    ({ type: 'wave', amplitude, frequency: 0.25, phase, waveType: 'sine', targetProperty: 'scale' });
  const d4 = computeProceduralPoseDelta([pa(scaleCfg(5, 0)), pa(scaleCfg(50, 180))], 'n1', 1);
  ok(near(d4.scaleMul, 0.15), `scale 累乘含钳制 scaleMul=0.15（实 ${d4.scaleMul}）`);
  const d5 = computeProceduralPoseDelta([pa(scaleCfg(50, 180))], 'n1', 1);
  ok(near(d5.scaleMul, 0.1), 'scale 单条深负值钳到 0.1');
  const d6 = computeProceduralPoseDelta([pa(scaleCfg(5, 0))], 'n1', 1);
  ok(near(d6.scaleMul, 1.5), 'scale 单条正值 ×1.5');
}

console.log('B) 计入条件（修改器门控已摘除）');
{
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { enabled: false })], 'n1', 1)), '未启用条目 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5)], 'n1', 101)), '帧在 endFrame 外 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { startFrame: 10 })], 'n1', 1)), '帧在 startFrame 前 → 零增量');
  ok(!isZeroDelta(computeProceduralPoseDelta([waveX(5, { startFrame: 1, endFrame: 1 })], 'n1', 1)), '帧界端点（含）→ 非零增量');
  // 不再要求节点挂对应修改器：汇总函数已无修改器入参，命中即出增量
  ok(near(computeProceduralPoseDelta([waveX(5)], 'n1', 1).dx, 5), 'translateX 命中即出增量（不要求 translate 修改器）');
  const rotCfg: ProceduralConfig = { type: 'wave', amplitude: 30, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'rotation' };
  ok(near(computeProceduralPoseDelta([pa(rotCfg)], 'n1', 1).rotDeg, 30), 'rotation 命中即出增量（不要求 rotate 修改器）');
  const scaleCfg: ProceduralConfig = { type: 'wave', amplitude: 5, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'scale' };
  ok(near(computeProceduralPoseDelta([pa(scaleCfg)], 'n1', 1).scaleMul, 1.5), 'scale 命中即出增量（不要求 uniform_scale 修改器）');
  // 混合：各属性独立汇总、互不设门
  const mixed = computeProceduralPoseDelta([waveX(5), pa(rotCfg)], 'n1', 1);
  ok(near(mixed.dx, 5) && near(mixed.rotDeg, 30), '各属性独立汇总：translate 与 rotation 同时出增量');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { nodeId: 'n2' })], 'n1', 1)), 'nodeId 不匹配 → 不串扰');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5)], undefined, 1)), 'nodeId 入参缺失且无解析精灵 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([], 'n1', 1)), '空列表 → 零增量');

  // 精灵通道：只挂精灵的条目落到「当前解析精灵正是它」的节点上
  const spritePa = waveX(5, { nodeId: undefined, spriteId: 's9' });
  const hitSprite = computeProceduralPoseDelta([spritePa], 'n1', 1, 's9');
  ok(near(hitSprite.dx, 5), `spriteId 命中解析精灵 → 出增量 dx=5（实 ${hitSprite.dx}）`);
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], 'n1', 1, 'sX')), 'spriteId 与解析精灵不符 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], 'n1', 1)), '未传解析精灵 → 精灵通道不命中');
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], 'n1', 1, '')), '解析精灵为空串 → 精灵通道不命中');
  const hitNoNodeArg = computeProceduralPoseDelta([spritePa], undefined, 1, 's9');
  ok(near(hitNoNodeArg.dx, 5), 'nodeId 入参缺失时精灵通道仍可命中');
  // 双通道同命中只计一次（nodeId 与 spriteId 指向同一节点同一条）
  const bothPa = waveX(5, { nodeId: 'n1', spriteId: 's9' });
  const bothHit = computeProceduralPoseDelta([bothPa], 'n1', 1, 's9');
  ok(near(bothHit.dx, 5), `双通道同命中只计一次 dx=5（实 ${bothHit.dx}）`);
  // 精灵通道同样只看启用与帧范围，不设修改器门控
  const spriteRot = pa(rotCfg, { nodeId: undefined, spriteId: 's9' });
  ok(near(computeProceduralPoseDelta([spriteRot], 'n1', 1, 's9').rotDeg, 30), '精灵通道 rotation 命中即出增量（不要求修改器）');
  ok(isZeroDelta(computeProceduralPoseDelta([waveX(5, { nodeId: undefined, spriteId: 's9', enabled: false })], 'n1', 1, 's9')), '精灵通道：未启用 → 零增量');
  ok(isZeroDelta(computeProceduralPoseDelta([spritePa], 'n1', 101, 's9')), '精灵通道：帧外 → 零增量');
}

console.log('C) 与播放器同式对拍');
{
  const rt = createDynamicRuntime();
  const dyn = (cfg: ProceduralConfig, f: number, sf = 0) => rt.dynProceduralValue(cfg as never, f, sf);
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
  for (const cfg of cfgs) {
    for (const f of [1, 17, 42]) {
      const v = dyn(cfg, f);
      const asX = computeProceduralPoseDelta([pa({ ...cfg, targetProperty: 'translateX' })], 'n1', f);
      const asRot = computeProceduralPoseDelta([pa({ ...cfg, targetProperty: 'rotation' })], 'n1', f);
      const asScale = computeProceduralPoseDelta([pa({ ...cfg, targetProperty: 'scale' })], 'n1', f);
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
  ok(!panel.includes('(s) => s.selectedCharacterId'), 'ProceduralPanel 不再订阅 selectedCharacterId（几乎无人维护、常为旧值）');
  ok(!panel.includes('[selectedCharacterId]'), 'ProceduralPanel 不再以 selectedCharacterId 查角色/nodes 推导目标节点');
  ok(panel.includes('activePuppetSkeletonId'), '目标角色优先按编辑器侧选择事实 activePuppetSkeletonId 找');
  ok(panel.includes('nodes?.[selectedNodeId]'), '目标节点按「角色实际包含 selectedNodeId」推导（节点 id 全局唯一）');

  const eng = readFileSync(new URL('../src/lib/engine/procedural.ts', import.meta.url), 'utf8');
  ok(eng.includes('export function applyProceduralAnimations'), 'applyProceduralAnimations 本体保留（已无调用方、其修改器查找行为不改）');
  ok(eng.includes('export function computeProceduralPoseDelta'), 'computeProceduralPoseDelta 已导出');
  ok(eng.includes('matchesSprite'), '引擎含精灵通道匹配（resolvedSpriteId）');
  ok(!eng.includes('hasEnabledModifier'), '引擎位姿增量汇总不再有修改器门控（hasEnabledModifier 已删）');

  ok(!panel.includes('ineffectiveNote'), '面板缺修改器点名（ineffectiveNote）整套机制已删');

  const conv = readFileSync(new URL('../src/lib/proc-runtime/convert.ts', import.meta.url), 'utf8');
  ok(!conv.includes('只有 spriteId 无 nodeId'), 'convert 不再以「只有 spriteId 无 nodeId」点名丢弃');
  ok(conv.includes('mountNodesOf') && conv.includes('目标精灵未被任何节点挂载'), 'convert 改按挂载关系解析精灵目标、无挂载时点名');
  ok(!conv.includes('无启用的') && !conv.includes('同样不生效'), 'convert 不再以缺启用修改器点名丢弃程序化条目（门控已摘除）');

  // 弹簧拉齐的接线
  ok(eng.includes('frame - startFrame') && eng.includes('amplitude ?? 5'), '引擎弹簧按局部帧起振、amplitude 缺省 5');
  ok(!eng.includes('frame / 60'), '引擎弹簧不再把帧数除以 60 折秒');
  const dynSrc = readFileSync(new URL('../src/lib/proc-runtime/dynamic-src.ts', import.meta.url), 'utf8');
  ok(dynSrc.includes('function dynProceduralValue(cfg, frame, startFrame)') && dynSrc.includes('amplitude ?? 5'), '运行时弹簧同式：带 startFrame、amplitude 缺省 5');
  ok(!dynSrc.includes('frame / 60'), '运行时弹簧不再把帧数除以 60 折秒');
  const rtSrc = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
  ok(rtSrc.includes('dynProceduralValue(pa.cfg, fIdx, pa.startFrame)'), '播放器调用 dynProceduralValue 传 pa.startFrame');
  ok(panel.includes('computeProceduralValue(config, frame, startFrame)') && panel.includes('computeProceduralValue(config, currentFrame, startFrame)'), '面板小预览两处取值都传条目 startFrame');
  ok(panel.includes('amplitude: 5') && panel.includes('config.amplitude ?? 5'), '面板弹簧默认带 amplitude 5、存量缺字段按 5 显示');
  ok(panel.includes('静止偏移') && !panel.includes('静止长度'), '面板弹簧参数名改为「静止偏移」、不再叫「静止长度」');

  // 噪声居中只改分支后处理、原语本体不动
  ok(eng.includes('* 2 - 1) * config.amplitude'), '引擎 noise 分支 ×2−1 居中后乘振幅');
  ok(dynSrc.includes('* 2 - 1) * cfg.amplitude'), '运行时 noise 分支同步 ×2−1 居中');
  const noiseSrc = readFileSync(new URL('../src/lib/engine/noise.ts', import.meta.url), 'utf8');
  ok(noiseSrc.includes('/ 2147483648'), 'noise.ts 的 hash/simplex2D/fbmNoise 原语本体未动（仍 [0,1) 口径）');
  ok(dynSrc.includes('2147483648'), 'dynProcNoise2D 原语本体未动（仍 [0,1) 口径）');
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
    { id: 'e3', name: '无修改器', spriteId: 'sprB', config: cfgX, enabled: true, startFrame: 0, endFrame: 100 },
    { id: 'e4', name: '节点目标', spriteId: '', nodeId: 'armL', config: cfgX, enabled: true, startFrame: 0, endFrame: 100 },
  ];
  const pkg = convertCharacterToRuntimePackage(char, undefined, { projectData: { proceduralAnimations: pas } });
  const entries = pkg.procedural ?? [];
  ok(entries.filter((e) => e.slot === 'armR').length === 1, '精灵目标落到第二个挂载节点 armR（一条）');
  ok(entries.filter((e) => e.slot === 'armL').length === 2, 'armL 吃到精灵目标 + 节点目标（两条）');
  ok(entries.filter((e) => e.slot === 'armX').length === 1, '无修改器的挂载节点 armX 照样进包（门控已摘除）');
  ok(entries.length === 4, `进包共 4 条（实 ${entries.length}）`);
  ok(pkg.warnings.some((w) => w.includes('无挂载') && w.includes('未被任何节点挂载')), '未被任何节点挂载的精灵条目被点名丢弃');
  ok(!pkg.warnings.some((w) => w.includes('无修改器')), '无修改器的精灵条目不再被点名（凭自身进包）');
}

console.log('F) 弹簧拉齐 + 噪声居中');
{
  const rt = createDynamicRuntime();
  const dynS = (cfg: ProceduralConfig, f: number, sf = 0) => rt.dynProceduralValue(cfg as never, f, sf);
  // 探针内按新口径手算（与实现独立复算）
  const springExpected = (cfg: { stiffness: number; damping: number; mass: number; amplitude?: number; restLength: number }, frame: number, startFrame = 0) => {
    const omega = Math.sqrt(cfg.stiffness / cfg.mass);
    const gamma = cfg.damping / (2 * cfg.mass);
    const dampedOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
    const lf = Math.max(0, frame - startFrame);
    return cfg.restLength + (cfg.amplitude ?? 5) * Math.exp(-gamma * lf) * Math.cos(dampedOmega * lf);
  };
  const springCfg = (over: Record<string, unknown> = {}): ProceduralConfig => ({
    type: 'spring', stiffness: 0.5, damping: 0.3, mass: 1, amplitude: 5, restLength: 2,
    targetProperty: 'translateX', ...over,
  } as ProceduralConfig);

  // lf=0：值 = restLength + amplitude（e^0=cos0=1）
  ok(near(computeProceduralValue(springCfg(), 0), 7), '弹簧 lf=0 → restLength + amplitude = 7');
  ok(near(computeProceduralValue(springCfg(), 40, 40), 7), '弹簧在 startFrame 当帧起振 → 同为 7');

  // 多帧与手算逐值对（两组参数，含负 restLength 与高阻尼）
  {
    const sets = [
      springCfg(),
      springCfg({ stiffness: 1.6, damping: 0.9, mass: 2.5, amplitude: 12, restLength: -3 }),
      springCfg({ stiffness: 0.2, damping: 0.05, mass: 0.5, amplitude: 3, restLength: 0 }),
    ];
    let all = true;
    for (const cfg of sets) {
      for (const f of [0, 1, 2, 3, 5, 8, 13, 21, 34, 60, 120]) {
        if (!near(computeProceduralValue(cfg, f), springExpected(cfg as never, f))) all = false;
        if (!near(computeProceduralValue(cfg, f + 40, 40), springExpected(cfg as never, f + 40, 40))) all = false;
      }
    }
    ok(all, '弹簧多帧多参数与手算新公式逐值一致（含 startFrame=40）');
  }

  // 衰减包络：|v − restLength| ≤ amplitude·e^(−γ·lf)，且采样点包络递减
  {
    const cfg = springCfg();
    const gamma = 0.3 / (2 * 1);
    let envOk = true;
    for (let f = 0; f <= 200; f++) {
      const v = computeProceduralValue(cfg, f);
      if (Math.abs(v - 2) > 5 * Math.exp(-gamma * f) + 1e-9) envOk = false;
    }
    ok(envOk, '弹簧全程落在衰减包络 amplitude·e^(−γ·lf) 内');
    const env = (lf: number) => 5 * Math.exp(-gamma * lf);
    ok(env(0) > env(10) && env(10) > env(20) && env(20) > env(40), '包络随 lf 单调递减');
    // 默认参数可见性自查：lf=20 已衰减到 5% 量级（e^−3≈0.0498），且前段确有大摆幅
    ok(Math.abs(computeProceduralValue(springCfg({ restLength: 0 }), 20)) <= 5 * Math.exp(-3) + 1e-9, '默认参数 lf=20 时 |v| 已 ≤ 振幅的 e^−3');
    ok(computeProceduralValue(springCfg({ restLength: 0 }), 5) < -2, '默认参数 lf=5 出现明显反向摆幅（< −2，看得见振荡）');
  }

  // 起始帧平移不变性：startFrame=40 在 frame=40+k 的值 == startFrame=0 在 frame=k 的值
  {
    let inv = true;
    for (let k = 0; k <= 60; k++) {
      if (!near(computeProceduralValue(springCfg(), 40 + k, 40), computeProceduralValue(springCfg(), k, 0))) inv = false;
    }
    ok(inv, '弹簧起始帧平移不变性（引擎取值）');
    // 经位姿增量同理：条目 startFrame=40、帧 40+k 的 dx == startFrame=0、帧 k 的 dx
    let invD = true;
    for (const k of [0, 1, 4, 9, 20]) {
      const a = computeProceduralPoseDelta([pa(springCfg(), { startFrame: 40, endFrame: 200 })], 'n1', 40 + k);
      const b = computeProceduralPoseDelta([pa(springCfg(), { startFrame: 0, endFrame: 200 })], 'n1', k);
      if (!near(a.dx, b.dx)) invD = false;
    }
    ok(invD, '弹簧起始帧平移不变性（位姿增量通路传 pa.startFrame）');
    // frame < startFrame：局部帧钳到 0（直接取值口径），值 = restLength + amplitude
    ok(near(computeProceduralValue(springCfg(), 10, 40), 7), 'frame < startFrame 时局部帧钳 0 → restLength + amplitude');
  }

  // 缺 amplitude 字段按 5 读（存量条目）：与显式 amplitude=5 逐帧同值
  {
    const legacy = springCfg(); delete (legacy as { amplitude?: number }).amplitude;
    let same = true;
    for (const f of [0, 3, 7, 15, 30]) {
      if (!near(computeProceduralValue(legacy, f), computeProceduralValue(springCfg(), f))) same = false;
      if (!near(dynS(legacy, f), computeProceduralValue(legacy, f))) same = false;
    }
    ok(same, '缺 amplitude 的存量弹簧按 5 读（引擎与运行时一致）');
  }

  // 引擎与 dyn 两份弹簧带 startFrame 逐值对拍
  {
    let par = true;
    for (const cfg of [springCfg(), springCfg({ stiffness: 1.2, damping: 0.5, mass: 0.8, amplitude: 8, restLength: -1 })]) {
      for (const sf of [0, 40]) {
        for (const f of [0, 1, 5, 12, 40, 41, 55, 90]) {
          if (!near(computeProceduralValue(cfg, f, sf), dynS(cfg, f, sf))) par = false;
        }
      }
    }
    ok(par, '弹簧引擎与 dyn 带 startFrame 逐值同值');
  }

  // 噪声居中：fbm 原语 [0,1) 不变，分支 ×2−1 后跨零、全值在 [−amplitude, amplitude]
  {
    const nCfg: ProceduralConfig = { type: 'noise', amplitude: 7, frequency: 0.05, octaves: 3, seed: 42, targetProperty: 'translateX' };
    let mn = Infinity, mx = -Infinity, inRange = true;
    for (let f = 0; f <= 400; f++) {
      const v = computeProceduralValue(nCfg, f);
      mn = Math.min(mn, v); mx = Math.max(mx, v);
      if (v < -7 || v >= 7) inRange = false;
    }
    ok(mn < 0 && mx > 0, `噪声取值有正有负（min=${mn.toFixed(2)} max=${mx.toFixed(2)}）`);
    ok(inRange, '噪声全值落在 [−amplitude, amplitude] 内');
    // 与原语复算逐值对：(fbmNoise(...)·2−1)·amplitude
    let rep = true;
    for (const f of [0, 1, 7, 33, 100, 255]) {
      const expect = (fbmNoise(f * 0.05, 0, 3, 42) * 2 - 1) * 7;
      if (!near(computeProceduralValue(nCfg, f), expect)) rep = false;
      if (!near(dynS(nCfg, f), expect)) rep = false;
    }
    ok(rep, '噪声 = (fbm 输出·2−1)·振幅，引擎与 dyn 逐值同式（原语未动）');
  }

  // 其余两类按改前公式复算逐值不变（wave/jitter 分支一字未动）
  {
    const oldWave = (cfg: Extract<ProceduralConfig, { type: 'wave' }>, frame: number) => {
      const t = frame * cfg.frequency + (cfg.phase / 360);
      const phase = t * Math.PI * 2;
      switch (cfg.waveType) {
        case 'sine': return Math.sin(phase) * cfg.amplitude;
        case 'triangle': return (2 * Math.abs(2 * (t % 1 - 0.5)) - 1) * cfg.amplitude;
        case 'square': return (Math.sin(phase) >= 0 ? 1 : -1) * cfg.amplitude;
        case 'sawtooth': return (2 * (t % 1) - 1) * cfg.amplitude;
        default: return Math.sin(phase) * cfg.amplitude;
      }
    };
    const oldJitter = (cfg: Extract<ProceduralConfig, { type: 'jitter' }>, frame: number) => {
      const seed = Math.floor(frame * cfg.frequency * 100);
      const rng = seededRandom(seed);
      if (cfg.smooth) return (simplex2D(frame * cfg.frequency, 0) * 2 - 1) * cfg.amount;
      return (rng() * 2 - 1) * cfg.amount;
    };
    let same = true;
    const waveCfgs: ProceduralConfig[] = (['sine', 'triangle', 'square', 'sawtooth'] as const).map((waveType) => ({
      type: 'wave', amplitude: 9, frequency: 0.3, phase: 40, waveType, targetProperty: 'translateX',
    }));
    for (const cfg of waveCfgs) {
      for (const f of [0, 1, 2, 7, 19, 58, 123]) {
        if (!near(computeProceduralValue(cfg, f), oldWave(cfg as never, f))) same = false;
      }
    }
    const jitCfgs: ProceduralConfig[] = [
      { type: 'jitter', amount: 3, frequency: 0.7, smooth: true, targetProperty: 'translateX' },
      { type: 'jitter', amount: 4, frequency: 1.3, smooth: false, targetProperty: 'translateX' },
    ];
    for (const cfg of jitCfgs) {
      for (const f of [0, 1, 5, 23, 77, 200]) {
        if (!near(computeProceduralValue(cfg, f), oldJitter(cfg as never, f))) same = false;
      }
    }
    ok(same, 'wave/jitter 与改前公式逐值不变');
  }
}

console.log(`\nverify-procedural-pose-delta: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
