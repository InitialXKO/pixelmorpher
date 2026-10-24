// Spike（乙方向）：动态模式模拟脱离编辑器独立运行的证据脚本。
// 从真工程 .pxm 取真实精灵网格 + 真实动态实例参数（如有），验：
// 确定性、存活上限、分层、镜像、形变曲线。跑法：
//   bun spikes/pattern-library/spike-sim-check.mts <pxm路径>
import { readFileSync } from 'node:fs';
import {
  defaultDynamicParams,
  dynamicDeformAt,
  normalizeDynamicParams,
  resolveDynamicPatterns,
  type DynamicPatternInstance,
} from '../../src/lib/dynamic-patterns';
import { simulateDynamicParticles } from '../../src/lib/dynamic-pattern-sim';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${extra}`); }
}

const pxmPath = process.argv[2];
const project = JSON.parse(readFileSync(pxmPath, 'utf-8')).project;

// 任取一张有像素的真实精灵作轮廓源
const sprites = Object.values<any>(project.sprites ?? {});
const sprite = sprites.find((s) => s?.data?.length && s.data.some((row: any[]) => row?.some((c: any) => c)));
if (!sprite) { console.log('工程里没有可用精灵网格'); process.exit(1); }
console.log(`精灵：${sprite.width}x${sprite.height}（plug=${JSON.stringify(sprite.plug ?? null)}）`);

// 工程里的真实动态实例（如有）：节点与服装件两处都找
let realInstance: DynamicPatternInstance | null = null;
for (const ch of Object.values<any>(project.unifiedCharacters ?? {})) {
  for (const nd of Object.values<any>(ch.nodes ?? {})) {
    if (nd.dynamicPatterns?.length) { realInstance = nd.dynamicPatterns[0]; break; }
  }
  if (!realInstance) {
    for (const cs of ch.costumeSets ?? []) {
      for (const pc of Object.values<any>(cs.pieces ?? {})) {
        if (pc.dynamicPatterns?.length) { realInstance = pc.dynamicPatterns[0]; break; }
      }
      if (realInstance) break;
    }
  }
  if (realInstance) break;
}
console.log(realInstance
  ? `真实实例：slot=${realInstance.slot} 发射=${realInstance.params.emitEnabled} 形变=${realInstance.params.deformEnabled} 发光=${realInstance.params.glowEnabled}`
  : '工程里没有动态实例（用缺省参数实例代替）');

const FPS = 8;
const mkResolved = (params: any) => resolveDynamicPatterns(
  [{ id: 'spike_inst', slot: '环境效果', enabled: true, params: normalizeDynamicParams(params) }], undefined,
)[0]!;
const inst = realInstance && realInstance.params.emitEnabled
  ? mkResolved(realInstance.params)
  : mkResolved(defaultDynamicParams());

// 1) 确定性：同输入两跑逐项相等
const a = simulateDynamicParticles(inst, sprite, 30, FPS, false, 'front', 'node_spike');
const b = simulateDynamicParticles(inst, sprite, 30, FPS, false, 'front', 'node_spike');
check('确定性：同输入两跑逐项相等', JSON.stringify(a) === JSON.stringify(b), `${a.length} vs ${b.length}`);

// 2) 计数与上限：48 帧里总粒子（两层合计）非空且不破单层上限
let sawParticles = false; let capOk = true; let maxTotal = 0;
const capFront = Math.max(1, Math.round(inst.instance.params.maxParticles * inst.instance.params.frontRatio));
const capBack = Math.max(1, Math.round(inst.instance.params.maxParticles * (1 - inst.instance.params.frontRatio)));
for (let f = 0; f < 48; f++) {
  const fr = simulateDynamicParticles(inst, sprite, f, FPS, false, 'front', 'node_spike');
  const bk = simulateDynamicParticles(inst, sprite, f, FPS, false, 'back', 'node_spike');
  if (fr.length + bk.length > 0) sawParticles = true;
  if (fr.length > capFront || bk.length > capBack) capOk = false;
  maxTotal = Math.max(maxTotal, fr.length + bk.length);
}
check('48 帧内粒子非空（发射在工作）', sawParticles);
check('分层上限不破（front/back 各自 cap）', capOk, `capFront=${capFront} capBack=${capBack} maxTotal=${maxTotal}`);

// 3) 分层：layer=both 时两层都有货（frontRatio=0.35）
let frontSeen = 0, backSeen = 0;
for (let f = 0; f < 48; f += 3) {
  frontSeen += simulateDynamicParticles(inst, sprite, f, FPS, false, 'front', 'node_spike').length;
  backSeen += simulateDynamicParticles(inst, sprite, f, FPS, false, 'back', 'node_spike').length;
}
check('分层：front/back 都有粒子', frontSeen > 0 && backSeen > 0, `front=${frontSeen} back=${backSeen}`);

// 4) 镜像：x 反号、其余一致
const m0 = simulateDynamicParticles(inst, sprite, 30, FPS, false, 'front', 'node_spike');
const m1 = simulateDynamicParticles(inst, sprite, 30, FPS, true, 'front', 'node_spike');
check('镜像：粒子数一致且 x 逐项反号',
  m0.length === m1.length && m0.every((p, i) => Math.abs(p.x + m1[i]!.x) < 1e-9 && p.y === m1[i]!.y && p.alpha === m1[i]!.alpha),
  `${m0.length} vs ${m1.length}`);

// 5) 形变曲线：正弦脉冲峰/谷 + 关闭恒等
const dp = { ...defaultDynamicParams(), deformEnabled: true, squashY: 0.8, stretchX: 1.2, deformHz: 1, deformPhase: 0 };
const peak = dynamicDeformAt(dp as any, 0.25);
const rest = dynamicDeformAt(dp as any, 0.75);
check('形变：t=0.25 脉冲峰（sx=1.2, sy=0.8）', Math.abs(peak.sx - 1.2) < 1e-9 && Math.abs(peak.sy - 0.8) < 1e-9, JSON.stringify(peak));
check('形变：t=0.75 脉冲谷（sx=sy=1）', Math.abs(rest.sx - 1) < 1e-9 && Math.abs(rest.sy - 1) < 1e-9, JSON.stringify(rest));
check('形变：未启用恒等', (() => { const d = dynamicDeformAt(defaultDynamicParams() as any, 0.25); return d.sx === 1 && d.sy === 1 && d.amount === 0; })());

// 6) 发射随形变调制：linkToDeform=1 且形变关（amount 恒 0）→ 发射率归零
const linked = mkResolved({ ...defaultDynamicParams(), linkToDeform: 1 });
let linkedTotal = 0;
for (let f = 0; f < 24; f++) linkedTotal += simulateDynamicParticles(linked, sprite, f, FPS, false, 'front', 'n2').length;
check('linkToDeform=1 且形变关：发射归零（调制口径成立）', linkedTotal === 0, `total=${linkedTotal}`);

console.log(`\nspike：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
