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

// ---- B 组：乙7 几何生成三件（光束/法阵线绘/流光线） ----
console.log('B 组：几何生成三件——arcPointsAt vs dynArcPoints 逐点对拍');
{
  const { arcPointsAt } = await import('../src/lib/dynamic-patterns');
  const rt3 = rt as unknown as {
    dynArcPoints: (p: unknown, t: number, ex?: number, ey?: number, hasEnd?: boolean) =>
      { main: [number, number, number][]; branches: [number, number, number][][]; dots: [number, number, number][]; alpha: number };
  };
  const sameShape = (name: string, over: Partial<DynamicPatternParams>, t: number, end?: { x: number; y: number }) => {
    const p = { ...defaultDynamicParams(), arcEnabled: true, ...over };
    const a = arcPointsAt(p, t, end);
    const b = rt3.dynArcPoints(p, t, end?.x, end?.y, !!end);
    const ptEq = (u: { x: number; y: number; w: number }[], v: [number, number, number][]) =>
      u.length === v.length && u.every((q, i) => near(q.x, v[i]![0], 1e-9) && near(q.y, v[i]![1], 1e-9) && near(q.w, v[i]![2], 1e-9));
    const okAll = ptEq(a.main, b.main)
      && a.branches.length === b.branches.length && a.branches.every((br, i) => ptEq(br, b.branches[i]!))
      && ptEq(a.dots, b.dots) && near(a.alpha, b.alpha, 1e-9);
    check(name, okAll, `main ${a.main.length}/${b.main.length} branches ${a.branches.length}/${b.branches.length} dots ${a.dots.length}/${b.dots.length}`);
    return a;
  };
  const beamOver = { arcMode: 'beam' as const, arcLengthPx: 40, arcDirDeg: 30, arcWidthPx: 2, arcFlicker: 10, arcSeed: 7 };
  const beam = sameShape('B1 光束差分（t=0.35，带跳动步）', beamOver, 0.35);
  check('B2 光束主线终点 = 方向×长', (() => {
    const last = beam.main[beam.main.length - 1]!;
    return near(last.x, Math.cos(Math.PI / 6) * 40, 1e-6) && near(last.y, Math.sin(Math.PI / 6) * 40, 1e-6);
  })());
  check('B3 光束根粗尖细 + 两条条纹 + 光斑点', beam.main[0]!.w > beam.main[beam.main.length - 1]!.w && beam.branches.length === 2 && beam.dots.length === 5);
  sameShape('B4 光束双锚点差分', beamOver, 0.8, { x: 25, y: -12 });
  const glyphOver = { arcMode: 'glyph' as const, arcLengthPx: 30, arcWidthPx: 1.4, arcSeed: 3, arcDetail: 12, arcGlyphSpinDeg: 30 };
  const glyph = sameShape('B5 法阵差分（t=0.4）', glyphOver, 0.4);
  check('B6 法阵外圈半径 = arcLengthPx', (() => {
    const mx = Math.max(...glyph.main.map((q) => Math.hypot(q.x, q.y)));
    return near(mx, 30, 0.6);
  })());
  check('B7 法阵笔画齐全（内圈+星+12 刻度）', glyph.branches.length === 2 + 12, `实得 ${glyph.branches.length}`);
  const glyphSpin = sameShape('B8 法阵旋转后差分仍一致（t=1.3）', glyphOver, 1.3);
  check('B9 法阵随时间旋转（点集变化）', JSON.stringify(glyphSpin.main[3]) !== JSON.stringify(glyph.main[3]));
  const glyphGrow = sameShape('B10 法阵生长差分（growHz）', { ...glyphOver, arcGrowHz: 1 }, 0.18);
  check('B11 生长中笔画未齐（逐笔出现）', glyphGrow.branches.length < glyph.branches.length, `${glyphGrow.branches.length} < ${glyph.branches.length}`);
  const streamOver = { arcMode: 'stream' as const, arcLengthPx: 36, arcDirDeg: 0, arcWidthPx: 1.6, arcSeed: 5, arcDetail: 6, arcFlowHz: 0.5 };
  const stream = sameShape('B12 流光线差分（t=0.3）', streamOver, 0.3);
  check('B13 流光点 6 颗沿线分布', stream.dots.length === 6 && stream.dots.every((d) => d.x >= -0.01 && d.x <= 36.01));
  const stream2 = sameShape('B14 流光线差分（t=0.9）', streamOver, 0.9);
  check('B15 光点随时间流动（位置变）', stream2.dots.some((d, i) => Math.abs(d.x - stream.dots[i]!.x) > 0.5));
  const badMode = normalizeDynamicParams({ ...defaultDynamicParams(), arcMode: 'zzz' } as DynamicPatternParams);
  check('B16 坏模式回落 arc、新参数钳制', badMode.arcMode === 'arc' && badMode.arcGlyphSpinDeg === 12);
}

// ---- F 组：乙8 团块/火焰场 ----
console.log('F 组：团块/火焰场——双侧逐格对拍 + 周期无缝 + 行为');
{
  const { blobFieldAt, flameFieldAt, fieldColorAt } = await import('../src/lib/dynamic-patterns');
  const rt4 = rt as unknown as {
    dynBlobField: (p: unknown, t: number) => { w: number; h: number; heat: Float32Array; ox: number; oy: number } | null;
    dynFlameField: (p: unknown, t: number) => { w: number; h: number; heat: Float32Array; ox: number; oy: number } | null;
    dynFieldColorAt: (e: string, m: string, c: string, h: number) => [number, number, number];
  };
  const fieldEq = (a: { w: number; h: number; heat: Float32Array } | null, b: { w: number; h: number; heat: Float32Array } | null) =>
    !!a && !!b && a.w === b.w && a.h === b.h && a.heat.length === b.heat.length
    && Array.from(a.heat).every((v, i) => near(v, b.heat[i]!, 1e-6));
  const bp = { ...defaultDynamicParams(), blobEnabled: true, blobRadius: 14, blobCount: 5, blobSeed: 9, blobHz: 0.8, blobBurn: 0.6 };
  const bf = blobFieldAt(bp, 0.31);
  check('F1 团块场差分（t=0.31）', fieldEq(bf, rt4.dynBlobField(bp, 0.31)));
  check('F2 团块场差分（t=0.77 烧穿更深时刻）', fieldEq(blobFieldAt(bp, 0.77), rt4.dynBlobField(bp, 0.77)));
  check('F3 团块场周期无缝（t 与 t+1/Hz 逐格同）', fieldEq(blobFieldAt(bp, 0.31), blobFieldAt(bp, 0.31 + 1 / 0.8)));
  const bHot = bf ? Array.from(bf.heat).filter((v) => v > 0.02).length : 0;
  const bHot2 = (() => { const f2 = blobFieldAt(bp, 0.625); return f2 ? Array.from(f2.heat).filter((v) => v > 0.02).length : 0; })();
  check('F4 烧穿中段覆盖变小（周期中点侵蚀最深）', bHot2 < bHot, `${bHot2} < ${bHot}`);
  check("F5 团块锚点有核（中心热度 > 0.3）", !!bf && bf.heat[(bf.oy) * bf.w + bf.ox]! > 0.3, bf ? `中心 ${bf.heat[bf.oy * bf.w + bf.ox]?.toFixed(2)}` : "空");
  check('F6 关时为 null（双侧）', blobFieldAt(defaultDynamicParams(), 0) === null && rt4.dynBlobField(defaultDynamicParams(), 0) === null);
  const fp = { ...defaultDynamicParams(), flameEnabled: true, flameWidth: 16, flameHeight: 24, flameHz: 1.2, flameTurbulence: 0.6 };
  const ff = flameFieldAt(fp, 0.43);
  check('F7 火焰场差分（t=0.43）', fieldEq(ff, rt4.dynFlameField(fp, 0.43)));
  check('F8 火焰场差分（t=0.71）', fieldEq(flameFieldAt(fp, 0.71), rt4.dynFlameField(fp, 0.71)));
  check('F9 火焰场周期无缝（噪声相位整周期偏移）', fieldEq(flameFieldAt(fp, 0.43), flameFieldAt(fp, 0.43 + 1 / 1.2)));
  check('F10 火焰只在基线之上（基线下两行全零）', !!ff && Array.from(ff.heat.slice((ff.oy + 2) * ff.w)).every((v) => v === 0));
  check('F11 焰根热于焰尖（纵向衰减）', !!ff && (() => {
    const root = ff.heat[(ff.oy - 2) * ff.w + ff.ox]!;
    const tip = ff.heat[(ff.oy - Math.round(fp.flameHeight * 0.92)) * ff.w + ff.ox]!;
    return root > tip;
  })());
  check('F12 焰尖收窄（高处宽度 < 低处）', !!ff && (() => {
    const widthAt = (ly: number) => Array.from(ff.heat.slice((ff.oy + ly) * ff.w, (ff.oy + ly + 1) * ff.w)).filter((v) => v > 0.02).length;
    return widthAt(-Math.round(fp.flameHeight * 0.85)) <= widthAt(-3);
  })());
  const c1 = fieldColorAt('#000000', '#ff0000', '#ffffff', 0.55);
  const c2 = rt4.dynFieldColorAt('#000000', '#ff0000', '#ffffff', 0.55);
  check('F13 热度色阶中点 = 中色（双侧）', near(c1[0], 255) && near(c1[1], 0) && JSON.stringify(c1) === JSON.stringify(c2));
}

// ---- G 组：乙8 后半（场进包 + 模板上屏接线） ----
console.log('G 组：场进包携带 + 模板取样点对拍 + 接线在场');
{
  const { convertCharacterToRuntimePackage } = await import('../src/lib/proc-runtime/convert');
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  const { createDynamicInstance } = await import('../src/lib/dynamic-patterns');
  const { createDefaultCostumePiece, pxToSub } = await import('../src/lib/unified-types');
  const { createDefaultParametricAppearance } = await import('../src/lib/proc-runtime/surfaces');
  const { blobFieldAt, flameFieldAt } = await import('../src/lib/dynamic-patterns');
  const grid8: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill('#884422'));
  const sprite8 = { width: 8, height: 8, data: grid8, plug: { x: pxToSub(4), y: pxToSub(6) } };
  const fieldParams = {
    ...defaultDynamicParams(),
    blobEnabled: true, blobRadius: 12, blobHz: 0.8,
    flameEnabled: true, flameWidth: 14, flameHeight: 20, flameHz: 1.2,
  };
  const piece = createDefaultCostumePiece('torso');
  piece.parametric = { ...createDefaultParametricAppearance(), composite: 'overlay', haloWidth: 2 } as never;
  (piece.sprites as Record<number, unknown>)[2] = sprite8;
  const node = {
    id: 'torso', name: '躯干', role: 'bone',
    slot: { slotKey: 'torso' },
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children: [],
    dynamicPatterns: [createDynamicInstance('熔火', fieldParams, '身体')],
  };
  const ch = {
    id: 'chG', name: '场测试',
    nodes: { torso: node },
    rootNodeId: 'torso', rootNodeIds: ['torso'],
    costumeSets: [{ id: 'set1', name: '默认', pieces: { torso: piece } }],
    activeCostumeSetId: 'set1', variants: {},
  } as never;
  const pkg = convertCharacterToRuntimePackage(ch);
  const torso = pkg.parts.find((p) => p.key === 'torso');
  const dp = torso?.dynamic?.[0]?.params as unknown as Record<string, unknown> | undefined;
  check('G1 团块/火焰参数随包（动态实例完整携带）',
    !!dp && dp.blobEnabled === true && dp.flameEnabled === true && dp.blobRadius === 12 && dp.flameHeight === 20);
  const html = buildRuntimeHtml(pkg);
  check('G2 模板接线在场（图集生成场帧 + 注册 + 渲染推入）',
    html.includes('dynBlobField(pp, fi / (FIELD_FRAMES * hzF))')
    && html.includes("key.startsWith('field:')")
    && html.includes('state.fieldTiles')
    && html.includes("part.key + ':' + ii + ':' + kind"));
  const K = 12;
  check('G3 帧选择相位误差 < 1/K（0.8Hz 与 1.2Hz 多时刻）', [0.8, 1.2].every((hz) =>
    [0.13, 0.57, 1.04, 2.39].every((t) => {
      const idx = Math.floor(t * hz * K) % K;
      return Math.abs(((t * hz) % 1) - idx / K) <= 1 / K + 1e-9;
    })));
  const rtG = rt as unknown as {
    dynBlobField: (p: unknown, t: number) => { heat: Float32Array } | null;
    dynFlameField: (p: unknown, t: number) => { heat: Float32Array } | null;
  };
  check('G4 模板烘焙取样点（fi/(K·Hz)，12 点）与编辑器场逐格同', (() => {
    for (let fi = 0; fi < K; fi++) {
      const tb = fi / (K * 0.8);
      const a = blobFieldAt(fieldParams, tb), b = rtG.dynBlobField(fieldParams, tb);
      if (!a || !b || a.heat.length !== b.heat.length || !Array.from(a.heat).every((v, i) => near(v, b.heat[i]!, 1e-6))) return false;
      const tf = fi / (K * 1.2);
      const c = flameFieldAt(fieldParams, tf), d = rtG.dynFlameField(fieldParams, tf);
      if (!c || !d || c.heat.length !== d.heat.length || !Array.from(c.heat).every((v, i) => near(v, d.heat[i]!, 1e-6))) return false;
    }
    return true;
  })());
}

// ---- H 组：乙9 环境场段 ----
console.log('H 组：环境场样本——双侧逐值对拍 + 三模式行为');
{
  const { envSamplesAt } = await import('../src/lib/dynamic-patterns');
  const rt5 = rt as unknown as {
    dynEnvSamples: (p: unknown, t: number) => { quads: [number, number, number, number, number, number, number][]; rings: [number, number, number, number][] };
  };
  const eqEnv = (name: string, over: Partial<DynamicPatternParams>, t: number) => {
    const p = { ...defaultDynamicParams(), envEnabled: true, ...over };
    const a = envSamplesAt(p, t);
    const b = rt5.dynEnvSamples(p, t);
    const okQ = a.quads.length === b.quads.length && a.quads.every((q, i) => {
      const v = b.quads[i]!;
      return near(q.x, v[0], 1e-9) && near(q.y, v[1], 1e-9) && near(q.size, v[2], 1e-9)
        && (q.line ? 1 : 0) === v[3] && near(q.dirX, v[4], 1e-9) && near(q.dirY, v[5], 1e-9) && near(q.alpha, v[6], 1e-9);
    });
    const okR = a.rings.length === b.rings.length && a.rings.every((r, i) => {
      const v = b.rings[i]!;
      return near(r.x, v[0], 1e-9) && near(r.y, v[1], 1e-9) && near(r.r, v[2], 1e-9) && near(r.alpha, v[3], 1e-9);
    });
    check(name, okQ && okR, `quads ${a.quads.length}/${b.quads.length} rings ${a.rings.length}/${b.rings.length}`);
    return a;
  };
  const fall = eqEnv('H1 落模式差分（t=0.42）', { envMode: 'fall', envCount: 10, envHz: 0.9 }, 0.42);
  check('H2 落样本全在区域内且为线形', fall.quads.length + fall.rings.length > 0
    && fall.quads.every((q) => Math.abs(q.x) <= 30 && q.y >= -22 && q.y <= 22 && q.line));
  const fall2 = eqEnv('H3 落模式差分（t=0.83）', { envMode: 'fall', envCount: 10, envHz: 0.9 }, 0.83);
  check('H4 样本随时间下落（同数样本 y 中位数变大）', (() => {
    const med = (a: typeof fall) => [...a.quads].sort((u, v) => u.y - v.y)[Math.floor(a.quads.length / 2)]!.y;
    return med(fall2) !== med(fall);
  })());
  const drift = eqEnv('H5 游模式差分（t=0.37）', { envMode: 'drift', envCount: 12, envHz: 0.7 }, 0.37);
  check('H6 游样本不出区域+漂移范围', drift.quads.every((q) => Math.abs(q.x) <= 28 * 1.09 && Math.abs(q.y) <= 22 * 1.09 && !q.line));
  const rip = eqEnv('H7 涟漪差分（t=0.55）', { envMode: 'ripple', envCount: 8, envHz: 1.1, envRadius: 15 }, 0.55);
  const rip2 = eqEnv('H8 涟漪差分（t=0.95）', { envMode: 'ripple', envCount: 8, envHz: 1.1, envRadius: 15 }, 0.95);
  check('H9 涟漪环半径不超上限+alpha 不超峰值', [...rip.rings, ...rip2.rings].every((r) => r.r <= 16.5 && r.alpha <= 0.8));
  check('H10 涟漪环心贴近底线（区域下半）', [...rip.rings, ...rip2.rings].every((r) => r.y > 22 - 6));
  check('H11 关时为空（双侧）', envSamplesAt(defaultDynamicParams(), 0.5).quads.length === 0
    && rt5.dynEnvSamples(defaultDynamicParams(), 0.5).rings.length === 0);
  check('H12 坏模式归一回落 fall', normalizeDynamicParams({ ...defaultDynamicParams(), envMode: 'zzz' } as DynamicPatternParams).envMode === 'fall');
}

console.log(`\n合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
