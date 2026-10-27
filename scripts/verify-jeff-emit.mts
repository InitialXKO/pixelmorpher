// ============================================================
// Jeff 落地·甲2+3 探针：发射段扩展（汇聚 gather / 生命颜色坡道 /
// 粒子形状）+ 环绕模式。行为断言口径：编辑器模拟与运行时孪生
// （DYNAMIC_SRC）逐粒子差分——消费者原路；坡道/环绕纯函数逐值
// 对拍；汇聚另测行为性质（粒子沿程向锚点内收、会穿过中心）。
// 运行：npx tsx scripts/verify-jeff-emit.mts
// ============================================================

import {
  defaultDynamicParams, normalizeDynamicParams, particleColorAt, orbitPointsAt,
  type DynamicPatternParams,
} from '../src/lib/dynamic-patterns';
import { simulateDynamicParticles } from '../src/lib/dynamic-pattern-sim';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';
import { pxToSub, type Sprite } from '../src/lib/unified-types';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` —— ${extra}` : ''}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const rt = createDynamicRuntime() as unknown as {
  dynSimulate: (inst: unknown, tile: unknown, frame: number, fr: number, layer: string, seed: string) => { x: number; y: number; size: number; alpha: number; color: string; shape: string; dirX: number; dirY: number }[];
  dynParticleColorAt: (p: unknown, f: number) => string;
  dynOrbitPoints: (p: unknown, t: number, ang?: number) => { x: number; y: number }[];
};

// ---- R 组：颜色坡道 ----
console.log('R 组：生命颜色坡道（编辑器纯函数 vs 运行时孪生）');
{
  const p = { ...defaultDynamicParams(), rampEnabled: true, rampFrom: '#000000', rampMid: '#ff0000', rampTo: '#ffffff', rampMidPos: 0.5 };
  check('R1 起点=起色', particleColorAt(p, 0) === '#000000');
  check('R2 中点=中色', particleColorAt(p, 0.5) === '#ff0000');
  check('R3 终点=终色', particleColorAt(p, 1) === '#ffffff');
  check('R4 前段中点插值', particleColorAt(p, 0.25) === '#800000');
  check('R5 后段中点插值', particleColorAt(p, 0.75) === '#ff8080');
  let twinOk = true;
  for (const f of [0, 0.13, 0.25, 0.5, 0.62, 0.75, 0.99, 1]) {
    if (rt.dynParticleColorAt(p, f) !== particleColorAt(p, f)) twinOk = false;
  }
  check('R6 孪生逐值一致（8 个生命比例）', twinOk);
  const off = { ...defaultDynamicParams(), color: '#123456' };
  check('R7 坡道关 = 恒本色', particleColorAt(off, 0.7) === '#123456' && rt.dynParticleColorAt(off, 0.7) === '#123456');
  const shifted = { ...p, rampMidPos: 0.25 };
  check('R8 中色位置可移', particleColorAt(shifted, 0.25) === '#ff0000' && particleColorAt(shifted, 0.5) !== '#ff0000');
}

// ---- O 组：环绕 ----
console.log('O 组：环绕光点（闭式位置 + 孪生对拍 + 世界基准反转）');
{
  const p = { ...defaultDynamicParams(), orbitEnabled: true, orbitCount: 4, orbitRadiusX: 20, orbitRadiusY: 10, orbitHz: 0.5, orbitPhase: 0 };
  const pts0 = orbitPointsAt(p, 0);
  check('O1 关时为空', orbitPointsAt(defaultDynamicParams(), 0).length === 0);
  check('O2 t=0 首点在 +X 半轴', pts0.length === 4 && near(pts0[0]!.x, 20) && near(pts0[0]!.y, 0));
  check('O3 四点均布（第二点在 +Y）', near(pts0[1]!.x, 0, 1e-9) && near(pts0[1]!.y, 10));
  const ptsQ = orbitPointsAt(p, 0.5);   // 0.5s × 0.5Hz = 1/4 圈
  check('O4 四分之一圈后首点到 +Y', near(ptsQ[0]!.x, 0, 1e-9) && near(ptsQ[0]!.y, 10));
  const w = orbitPointsAt({ ...p, orbitAngleSpace: 'world' }, 0, 90);
  check('O5 世界基准：部件转 90° 时首点反转到 −Y（恒对世界）', near(w[0]!.x, 0, 1e-9) && near(w[0]!.y, -20));
  let twinOk = true;
  for (const t of [0, 0.3, 1.7]) {
    const a = orbitPointsAt(p, t), b = rt.dynOrbitPoints(p, t, 0);
    if (a.length !== b.length || a.some((q, i) => !near(q.x, b[i]!.x, 1e-9) || !near(q.y, b[i]!.y, 1e-9))) twinOk = false;
    const aw = orbitPointsAt({ ...p, orbitAngleSpace: 'world' }, t, 33);
    const bw = rt.dynOrbitPoints({ ...p, orbitAngleSpace: 'world' }, t, 33);
    if (aw.some((q, i) => !near(q.x, bw[i]!.x, 1e-9) || !near(q.y, bw[i]!.y, 1e-9))) twinOk = false;
  }
  check('O6 孪生逐点一致（精灵/世界两种基准）', twinOk);
  const back = orbitPointsAt({ ...p, orbitHz: -0.5 }, 0.5);
  check('O7 负转速反向', near(back[0]!.x, 0, 1e-9) && near(back[0]!.y, -10));
}

// ---- G 组：粒子模拟差分（out 回归 + gather 行为） ----
console.log('G 组：粒子模拟——编辑器 vs 运行时孪生逐粒子差分');
const gridB: (string | null)[][] = Array.from({ length: 5 }, () => Array(5).fill('#808080'));
const spriteB = {
  width: 5, height: 5, data: gridB,
  plug: { x: pxToSub(1), y: pxToSub(2) },
} as unknown as Sprite;
function tileOf(): { w: number; h: number; cx: number; cy: number; data: Uint8Array } {
  const data = new Uint8Array(5 * 5 * 4);
  for (let i = 0; i < 25; i++) { data[i * 4] = 0; data[i * 4 + 3] = 255; }
  return { w: 5, h: 5, cx: 1, cy: 2, data };
}
function diffSim(name: string, over: Partial<DynamicPatternParams>, frame: number) {
  const params = { ...defaultDynamicParams(), ...over };
  const r = { instance: { id: 'j1', slot: '身体', enabled: true, params }, origin: 'node' as const };
  const a = simulateDynamicParticles(r, spriteB, frame, 12, false, 'front', 'nodeX');
  const b = rt.dynSimulate({ id: 'j1', slot: '身体', params }, tileOf(), frame, 12, 'front', 'nodeX');
  const same = a.length === b.length && a.every((p, i) => {
    const q = b[i]!;
    return near(p.x, q.x, 1e-9) && near(p.y, q.y, 1e-9) && near(p.size, q.size, 1e-9)
      && near(p.alpha, q.alpha, 1e-9) && p.color === q.color && p.shape === q.shape
      && near(p.dirX, q.dirX, 1e-9) && near(p.dirY, q.dirY, 1e-9);
  });
  check(name, same && a.length > 0, `编辑器 ${a.length} vs 孪生 ${b.length}`);
  return a;
}
{
  const base = { source: 'contour' as const, layer: 'front' as const, frontRatio: 1 };
  diffSim('G1 out 模式回归（新代码路径与孪生一致）', { ...base }, 30);
  const gatherOver = {
    ...base, source: 'plug' as const, emitMode: 'gather' as const, gatherRadius: 16,
    directionDeg: 0, speed: 12, spreadDeg: 0, turbulence: 0, rise: 0, buoy: 0,
    life: 1.2, rate: 48, particleShape: 'line' as const,
    rampEnabled: true, rampFrom: '#102030', rampMid: '#ff8800', rampTo: '#ffffff',
  };
  const ps = diffSim('G2 gather 全特性差分（汇聚+坡道+流光线形状）', gatherOver, 30);
  // 行为：v（向外）= (12, −6)，v̂ = (0.894, −0.447)；汇聚后沿程坐标只减不增
  const ux = 0.8944, uy = -0.4472;
  const along = ps.map((p) => p.x * ux + p.y * uy);
  check('G3 沿程坐标 ≤ 出生距上限 16（只内收不外扩）', along.every((v) => v <= 16 + 1e-6), `max=${Math.max(...along).toFixed(2)}`);
  check('G4 已有粒子穿过中心（沿程坐标为负）', along.some((v) => v < 0));
  check('G5 流光线方向 = 汇聚后速度方向（指向内）', ps.every((p) => near(p.dirX * ux + p.dirY * uy, -1, 1e-3)));
  check('G6 形状字段贯通', ps.every((p) => p.shape === 'line'));
  check('G7 坡道色贯通（颜色不是单色）', new Set(ps.map((p) => p.color)).size >= 3);
}

// ---- N 组：normalize 守卫 ----
console.log('N 组：旧数据补齐与守卫');
{
  const old = JSON.parse(JSON.stringify(defaultDynamicParams()));
  delete old.emitMode; delete old.orbitCount; delete old.particleShape;
  const n = normalizeDynamicParams(old);
  check('N1 缺字段补默认', n.emitMode === 'out' && n.particleShape === 'dot' && n.orbitCount === 3 && n.orbitEnabled === false);
  const bad = normalizeDynamicParams({ ...defaultDynamicParams(), emitMode: 'xx', particleShape: 'yy', orbitCount: 99, rampMidPos: 7 } as DynamicPatternParams);
  check('N2 坏值回落与钳制', bad.emitMode === 'out' && bad.particleShape === 'dot' && bad.orbitCount === 12 && bad.rampMidPos === 1);
}

// ---- T 组：甲1 组合配方模板 ×13 ----
console.log('T 组：组合配方模板 ×13 入库（配方核心段断言）');
{
  const { DYNAMIC_PATTERN_TEMPLATES, findDynamicTemplate } = await import('../src/lib/dynamic-patterns');
  check('T1 模板总数 22（原 9 + 新 13）', DYNAMIC_PATTERN_TEMPLATES.length === 22, `实际 ${DYNAMIC_PATTERN_TEMPLATES.length}`);
  const seg = (name: string, fn: (p: DynamicPatternParams) => boolean, label: string) => {
    const t = findDynamicTemplate(name);
    check(`T·${name}：${label}`, !!t && fn(t.params));
  };
  seg('火焰斩', (p) => p.arcEnabled && p.glowEnabled && p.rampEnabled, '弧线+发光+火色坡道');
  seg('寒冰斩', (p) => p.arcEnabled && p.particleShape === 'diamond' && p.rampEnabled, '弧线+菱形冰晶+冰色坡道');
  seg('暗影斩', (p) => p.arcEnabled && p.trailEnabled, '弧线+残影');
  seg('重击', (p) => p.arcEnabled && p.particleShape === 'star' && p.glowStrength >= 1.2, '弧线分叉+星形爆射+强发光脉冲');
  seg('暴击', (p) => p.arcBranches === 3 && p.rate > findDynamicTemplate('重击')!.params.rate, '比重击更多分叉与爆射');
  seg('落雷', (p) => p.arcEnabled && p.arcDirDeg === 90 && p.arcGrowHz > 0 && p.particleShape === 'line', '向下生长弧线+流光电火花');
  seg('地面冲击波', (p) => p.source === 'contour-bottom' && p.spreadDeg >= 130, '底部宽散布尘浪');
  seg('治疗', (p) => p.orbitEnabled && p.rise > 0 && p.glowEnabled, '环绕光点+上升粒子+绿发光');
  seg('增益光环', (p) => p.orbitEnabled && p.orbitRadiusY < p.orbitRadiusX, '扁椭圆环绕（脚下环）+上升粒子');
  seg('拾取闪光', (p) => p.particleShape === 'star' && p.glowShape === 'star', '星形粒子+星形辉光');
  seg('冲刺残影', (p) => p.trailEnabled && p.trailCount >= 5 && p.particleShape === 'line', '多残影+流光线');
  seg('落地尘土', (p) => p.source === 'contour-bottom' && p.sizeEnd > p.sizeStart, '底部尘土扩散');
  seg('水花', (p) => p.buoy < -50 && p.particleShape === 'diamond', '强重力水滴（菱形）抛物线');
}

// ---- U 组：甲5 图案级全局后期 ----
console.log('U 组：全局后期（色板主题/透明度分级/抖动消散）');
{
  const { postColorAt, POST_THEME_RAMPS } = await import('../src/lib/dynamic-patterns');
  const rt2 = rt as unknown as { dynPostColorAt: (p: unknown, hex: string) => string };
  const mono = { ...defaultDynamicParams(), postEnabled: true, postTheme: 'mono' as const };
  check('U1 关 = 原样', postColorAt(defaultDynamicParams(), '#3a7bd5') === '#3a7bd5');
  check('U2 单色主题两端锚定', postColorAt(mono, '#000000') === '#000000' && postColorAt(mono, '#ffffff') === '#ffffff');
  check('U3 单色主题输出恒灰阶', (() => { const c = postColorAt(mono, '#ff2020'); return c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7); })());
  const ember = { ...defaultDynamicParams(), postEnabled: true, postTheme: 'ember' as const };
  check('U4 余烬主题白色落顶站', postColorAt(ember, '#ffffff') === '#fff3c4');
  let sweep = true;
  for (const theme of ['ember', 'frost', 'gameboy', 'dusk', 'mono'] as const) {
    const pp = { ...defaultDynamicParams(), postEnabled: true, postTheme: theme };
    for (const hex of ['#000000', '#7a3b10', '#3a7bd5', '#c8c8c8', '#ffffff', '#12ab34']) {
      if (rt2.dynPostColorAt(pp, hex) !== postColorAt(pp, hex)) sweep = false;
    }
  }
  check('U5 孪生主题映射逐值一致（5 主题 × 6 色）', sweep);
  check('U6 主题表五站齐全', Object.values(POST_THEME_RAMPS).every((r) => r.length === 5));
  // 模拟层：分级量化 + 抖动掉落，仍走差分原路
  const base = { source: 'contour' as const, layer: 'front' as const, frontRatio: 1 };
  const q = diffSim('U7 透明度分级差分', { ...base, postEnabled: true, postAlphaLevels: 4, alpha: 1 }, 30);
  check('U8 分级后 alpha 恒为 0.25 的倍数', q.every((p) => Math.abs(p.alpha * 4 - Math.round(p.alpha * 4)) < 1e-9));
  const plain = simulateDynamicParticles(
    { instance: { id: 'j1', slot: '身体', enabled: true, params: { ...defaultDynamicParams(), ...base } }, origin: 'node' },
    spriteB, 30, 12, false, 'front', 'nodeX');
  const dith = diffSim('U9 抖动消散差分', { ...base, postEnabled: true, postDither: true }, 30);
  check('U10 抖动存活者全 alpha（无平滑淡出）', dith.every((p) => Math.abs(p.alpha - 0.5) < 1e-9), 'default alpha=0.5');
  check('U11 抖动确实掉落（存活数变少）', dith.length < plain.length, `${dith.length} < ${plain.length}`);
  const themed = diffSim('U12 主题色贯通粒子', { ...base, postEnabled: true, postTheme: 'frost' as const }, 30);
  check('U13 主题后粒子色落在寒霜色阶邻域（蓝通道不低于红）', themed.every((p) => {
    const r = parseInt(p.color.slice(1, 3), 16), b = parseInt(p.color.slice(5, 7), 16);
    return b >= r;
  }));
}

// ---- C 组：甲6 cleanup 去孤点 ----
console.log('C 组：去孤点算子（注册表 + 蓝图求值 + 列表转图三路）');
{
  const { modifierRegistry } = await import('../src/lib/engine/pixel-modifiers');
  const G = (rows: string[]): (string | null)[][] => rows.map((r) => r.split('').map((c) => (c === '#' ? '#a0a0a0' : null)));
  // 7×6（共 14 点）：3×3 块（9) + 孤点（5,1) + 空行 + 2 连块 + 两孤点
  const grid = G([
    '###....',
    '###..#.',
    '###....',
    '.......',
    '..##..#',
    '.#.....',
  ]);
  const count = (g: (string | null)[][]) => g.flat().filter((c) => c).length;
  const handler = modifierRegistry.get('cleanup');
  check('C1 注册表有 cleanup', !!handler);
  const r2 = handler!({ minSize: 2 }, grid, 0);
  check('C2 minSize=2：三个孤点清除（14→11）', count(r2) === 11, `实得 ${count(r2)}`);
  const r3 = handler!({ minSize: 3 }, grid, 0);
  check('C3 minSize=3：2 连块也清除（14→9）', count(r3) === 9, `实得 ${count(r3)}`);
  const r1 = handler!({ minSize: 1 }, grid, 0);
  check('C4 minSize=1：原样', count(r1) === 14);
  check('C5 原图未被改动（不可变）', count(grid) === 14);
  check('C6 大块保留颜色与位置', r3[0]![0] === '#a0a0a0' && r3[2]![2] === '#a0a0a0');
  // 蓝图求值原路：sprite_source → cleanup 节点
  const { evaluateNodeOutput } = await import('../src/lib/blueprint/eval');
  const { asPixels } = await import('../src/lib/blueprint/ir');
  const graph = {
    nodes: [
      { id: 'src', type: 'sprite_source', params: {}, inputs: {}, ui: { x: 0, y: 0 } },
      { id: 'c1', type: 'cleanup', params: { minSize: 3 }, inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, ui: { x: 1, y: 0 } },
      { id: 'k', type: 'const', params: { value: 2 }, inputs: {}, ui: { x: 0, y: 1 } },
      { id: 'c2', type: 'cleanup', params: { minSize: 3 }, inputs: { pixels: { nodeId: 'src', output: 'pixels' }, minSize: { nodeId: 'k', output: 'out' } }, ui: { x: 2, y: 0 } },
    ],
    outputId: 'c1',
  };
  const ctx = { frame: 0, frameRate: 12, vars: {}, spritePixels: grid } as never;
  const out1 = evaluateNodeOutput(graph as never, 'c1', ctx) as Record<string, unknown> | null;
  const g1 = out1 ? asPixels(out1.pixels as never) : null;
  check('C7 蓝图节点求值：minSize=3 生效（余 9）', !!g1 && count(g1) === 9, g1 ? `实得 ${count(g1)}` : '无输出');
  const out2 = evaluateNodeOutput(graph as never, 'c2', ctx) as Record<string, unknown> | null;
  const g2 = out2 ? asPixels(out2.pixels as never) : null;
  check('C8 接线覆盖 minSize=2：2 连块保留（余 11）', !!g2 && count(g2) === 11, g2 ? `实得 ${count(g2)}` : '无输出');
  // 列表 → 图：modifiersToBlueprint 链上出现 cleanup 节点
  const { modifiersToBlueprint } = await import('../src/lib/blueprint/migrate');
  const g3 = modifiersToBlueprint([{ id: 'm1', type: 'cleanup', enabled: true, params: { minSize: 2 } } as never]);
  check('C9 修改器列表转图含 cleanup 节点', !!g3 && g3.nodes.some((n) => n.type === 'cleanup'));
}

console.log(`\n合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
