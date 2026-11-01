// ============================================================
// 弧线段扩展探针：环带 ring + 扇面 fan（pixelfx 对照落地）
// 口径：生成器性质（椭圆方程/前后半分界/生长单调/扇边与 arc
// 模式逐点同形/边界闭合）+ 编辑器 arcPointsAt 与包内孪生
// dynArcPoints 逐点对拍 + arc 模式回归基线（值抄自 main 现行
// 实现，改动前生成）+ 消费端接线在位（源码级，与 TR3c 同例）。
// 运行：bun scripts/verify-arc-ring-fan.mts
// ============================================================

import {
  arcPointsAt, arcGrowFrac, defaultDynamicParams, normalizeDynamicParams,
  type DynamicPatternParams,
} from '../src/lib/dynamic-patterns';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` —— ${extra}` : ''}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const rt = createDynamicRuntime() as unknown as {
  dynArcPoints: (p: unknown, t: number, ex?: number, ey?: number, hasEnd?: boolean) =>
    { main: [number, number, number][]; branches: [number, number, number][][]; dots: [number, number, number][]; alpha: number };
};

type P = Partial<DynamicPatternParams>;
const mk = (over: P): DynamicPatternParams => normalizeDynamicParams({ ...defaultDynamicParams(), arcEnabled: true, ...over });

function sameShape(name: string, p: DynamicPatternParams, t: number) {
  const a = arcPointsAt(p, t);
  const b = rt.dynArcPoints(p as never, t);
  const ptEq = (u: { x: number; y: number; w: number }[], v: [number, number, number][]) =>
    u.length === v.length && u.every((q, i) => near(q.x, v[i]![0], 1e-9) && near(q.y, v[i]![1], 1e-9) && near(q.w, v[i]![2], 1e-9));
  const okAll = ptEq(a.main, b.main)
    && a.branches.length === b.branches.length && a.branches.every((br, i) => ptEq(br, b.branches[i]!))
    && ptEq(a.dots, b.dots) && near(a.alpha, b.alpha, 1e-9);
  check(name, okAll, `main ${a.main.length}/${b.main.length} branches ${a.branches.length}/${b.branches.length} alpha ${a.alpha}/${b.alpha}`);
  return a;
}

// ---- R 组：环带 ring ----
console.log('R 组：环带——结构 / 椭圆方程 / 前后半分界 / 生长 / 孪生');
{
  const R = 40, TILT = 0.35;
  const p = mk({ arcMode: 'ring', arcLengthPx: R, arcDirDeg: 0, arcTilt: TILT, arcWidthPx: 2, arcFlicker: 0, arcSeed: 7, arcGrowHz: 0 });
  const s = arcPointsAt(p, 0.5);
  check('R1 结构：圆心哨点 main=1、两半环各 29 点、无光点、alpha=0.9',
    s.main.length === 1 && s.main[0]!.x === 0 && s.main[0]!.y === 0
    && s.branches.length === 2 && s.branches[0]!.length === 29 && s.branches[1]!.length === 29
    && s.dots.length === 0 && near(s.alpha, 0.9, 1e-9));
  // 椭圆方程：归一化半径 ρ = sqrt((x/R)² + (y/(R·tilt))²)，点到椭圆的
  // 径向偏差以 |ρ−1|·R 计（主轴处即 px)，须 ≤ 0.6px
  const ellErr = (q: { x: number; y: number }) =>
    Math.abs(Math.sqrt((q.x / R) ** 2 + (q.y / (R * TILT)) ** 2) - 1) * R;
  const maxErr = Math.max(...s.branches.flat().map(ellErr));
  check('R2 全部环点在椭圆方程上（偏差 ≤0.6px）', maxErr <= 0.6, `maxErr=${maxErr}`);
  check('R3 前后半分界：branches[0] 全 y≤0、branches[1] 全 y≥0（容浮点 1e-9）',
    s.branches[0]!.every((q) => q.y <= 1e-9) && s.branches[1]!.every((q) => q.y >= -1e-9));
  check('R4 两半在 (±R, 0) 共点闭合',
    near(s.branches[0]![0]!.x, -R, 1e-9) && near(s.branches[0]![0]!.y, 0, 1e-9)
    && near(s.branches[1]![28]!.x, -R, 1e-9) && near(s.branches[1]![28]!.y, 0, 1e-9)
    && near(s.branches[0]![28]!.x, R, 1e-9) && near(s.branches[1]![0]!.x, R, 1e-9));
  check('R5 环带厚度：全部点 w = arcWidthPx', s.branches.flat().every((q) => q.w === 2));
  // 方向角旋转：dir=90° 时在旋转系里验椭圆方程（逆旋转回本地）
  const p90 = mk({ arcMode: 'ring', arcLengthPx: R, arcDirDeg: 90, arcTilt: TILT, arcWidthPx: 2, arcFlicker: 0, arcSeed: 7 });
  const s90 = arcPointsAt(p90, 0.2);
  const cd = Math.cos(Math.PI / 2), sd = Math.sin(Math.PI / 2);
  const maxErr90 = Math.max(...s90.branches.flat().map((q) => ellErr({ x: q.x * cd + q.y * sd, y: -q.x * sd + q.y * cd })));
  check('R6 方向 90°：逆旋转后仍在椭圆上', maxErr90 <= 0.6, `maxErr=${maxErr90}`);
  // 生长：半径随相位单调长满、alpha 随 (1−grow) 淡出
  const pg = mk({ arcMode: 'ring', arcLengthPx: R, arcDirDeg: 0, arcTilt: TILT, arcWidthPx: 2, arcFlicker: 0, arcSeed: 7, arcGrowHz: 1 });
  const radiusAt = (t: number) => Math.max(...arcPointsAt(pg, t).branches.flat().map((q) => Math.abs(q.x)));
  const r1 = radiusAt(0.1), r2 = radiusAt(0.3), r3 = radiusAt(0.55), r4 = radiusAt(0.85);
  check('R7 生长半径单调增至满半径', r1 > 0 && r1 < r2 && r2 < r3 && r3 < R && near(r4, R, 1e-9),
    `${r1} ${r2} ${r3} ${r4}`);
  const aAt = (t: number) => arcPointsAt(pg, t).alpha;
  check('R8 生长 alpha = 0.9·(1−grow) 且单调淡出',
    near(aAt(0.2), 0.9 * (1 - arcGrowFrac(pg, 0.2)), 1e-9)
    && aAt(0.1) > aAt(0.35) && aAt(0.35) > aAt(0.6) && near(aAt(0.85), 0, 1e-9),
    `${aAt(0.1)} ${aAt(0.35)} ${aAt(0.6)} ${aAt(0.85)}`);
  sameShape('R9 环带孪生逐点一致（静止）', p, 0.5);
  sameShape('R10 环带孪生逐点一致（生长中）', pg, 0.33);
  const pTilt1 = mk({ arcMode: 'ring', arcLengthPx: 24, arcDirDeg: 130, arcTilt: 1, arcWidthPx: 1, arcFlicker: 6, arcSeed: 3 });
  sameShape('R11 环带孪生逐点一致（直立圆+跳动）', pTilt1, 1.21);
}

// ---- F 组：扇面 fan ----
console.log('F 组：扇面——闭合 / 弦链与 arc 模式逐点同形 / 径向梯度 / 生长 / 孪生');
{
  const L = 36, DIR = 20, FAN = 70;
  const p = mk({ arcMode: 'fan', arcLengthPx: L, arcDirDeg: DIR, arcFanDeg: FAN, arcDisplace: 0.4, arcWidthPx: 1.4, arcFlicker: 10, arcSeed: 11, arcGrowHz: 0 });
  const t = 0.57;
  const s = arcPointsAt(p, t);
  check('F1 边界闭合：19 点、首尾同为原点、w 首尾为 0',
    s.main.length === 19
    && s.main[0]!.x === 0 && s.main[0]!.y === 0 && s.main[0]!.w === 0
    && s.main[18]!.x === 0 && s.main[18]!.y === 0 && s.main[18]!.w === 0
    && s.branches.length === 0 && s.dots.length === 0);
  const half = (FAN * Math.PI) / 360;
  const dirR = (DIR * Math.PI) / 180;
  const A = { x: Math.cos(dirR - half) * L, y: Math.sin(dirR - half) * L };
  const B = { x: Math.cos(dirR + half) * L, y: Math.sin(dirR + half) * L };
  check('F2 两弧端点精确落在 ±半角射线、半径 = L',
    near(s.main[1]!.x, A.x, 1e-9) && near(s.main[1]!.y, A.y, 1e-9)
    && near(s.main[17]!.x, B.x, 1e-9) && near(s.main[17]!.y, B.y, 1e-9));
  // 外弧弦链与 arc 模式同参主弧逐点一致（差平移 A)：arc 模式取
  // 方向 = 弦方向、长 = 弦长、同 disp/seed/flicker → 同一步进
  const chord = { x: B.x - A.x, y: B.y - A.y };
  const chordLen = Math.hypot(chord.x, chord.y);
  const chordDir = (Math.atan2(chord.y, chord.x) * 180) / Math.PI;
  const pArc = mk({ arcMode: 'arc', arcLengthPx: chordLen, arcDirDeg: chordDir, arcDisplace: 0.4, arcBranches: 0, arcWidthPx: 1.4, arcFlicker: 10, arcSeed: 11 });
  const sArc = arcPointsAt(pArc, t);
  let chainOk = sArc.main.length === 17;
  for (let i = 0; i < 17 && chainOk; i++) {
    const fq = s.main[1 + i]!, aq = sArc.main[i]!;
    if (!near(fq.x, aq.x + A.x, 1e-9) || !near(fq.y, aq.y + A.y, 1e-9)) chainOk = false;
  }
  check('F3 外弧链 17 点与 arc 模式同参主弧逐点一致（平移 A）', chainOk);
  check('F4 径向占比 w：端点 = 1、全程 ∈ [0,1]、链内点 > 0.25',
    near(s.main[1]!.w, 1, 1e-9) && near(s.main[17]!.w, 1, 1e-9)
    && s.main.every((q) => q.w >= 0 && q.w <= 1)
    && s.main.slice(2, 17).every((q) => q.w > 0.25));
  // 生长截断：未闭合（末点非原点、点数变少），长满后恢复闭合
  const pg = mk({ arcMode: 'fan', arcLengthPx: L, arcDirDeg: DIR, arcFanDeg: FAN, arcDisplace: 0.4, arcWidthPx: 1.4, arcFlicker: 0, arcSeed: 11, arcGrowHz: 1 });
  const sg = arcPointsAt(pg, 0.2);
  const last = sg.main[sg.main.length - 1]!;
  check('F5 生长中边界截断未闭合', sg.main.length < 19 && !(last.x === 0 && last.y === 0),
    `len=${sg.main.length} last=(${last.x},${last.y})`);
  const sf = arcPointsAt(pg, 0.9);
  check('F6 生长满后恢复闭合 19 点', sf.main.length === 19 && sf.main[18]!.x === 0 && sf.main[18]!.y === 0);
  sameShape('F7 扇面孪生逐点一致', p, t);
  sameShape('F8 扇面孪生逐点一致（生长中）', pg, 0.2);
  const pWide = mk({ arcMode: 'fan', arcLengthPx: 48, arcDirDeg: 300, arcFanDeg: 160, arcDisplace: 0.65, arcWidthPx: 2, arcFlicker: 4, arcSeed: 99 });
  sameShape('F9 扇面孪生逐点一致（宽角+大曲折）', pWide, 2.3);
}

// ---- N 组：规范化 ----
console.log('N 组：新参数规范化与缺省');
{
  const d = defaultDynamicParams();
  check('N1 缺省 arcTilt=0.35、arcFanDeg=70', d.arcTilt === 0.35 && d.arcFanDeg === 70);
  const n = normalizeDynamicParams({ ...d, arcMode: 'ring', arcTilt: 0, arcFanDeg: 999 } as DynamicPatternParams);
  check('N2 钳制：arcTilt 0→0.16、arcFanDeg 999→300、ring 模式保留',
    n.arcTilt === 0.16 && n.arcFanDeg === 300 && n.arcMode === 'ring');
  const n2 = normalizeDynamicParams({ ...d, arcMode: 'fan', arcTilt: 2, arcFanDeg: 3 } as DynamicPatternParams);
  check('N3 钳制：arcTilt 2→1、arcFanDeg 3→10、fan 模式保留',
    n2.arcTilt === 1 && n2.arcFanDeg === 10 && n2.arcMode === 'fan');
  const bad = normalizeDynamicParams({ ...d, arcMode: 'zzz' } as unknown as DynamicPatternParams);
  check('N4 坏模式仍回落 arc', bad.arcMode === 'arc');
}

// ---- G 组：回归——arc 模式基线（值抄自 main 现行实现）+ 旧模式孪生抽查 ----
console.log('G 组：六模式回归（基线锁定 + 孪生抽查）');
{
  const BASE = {
    alpha: 0.6639162301435135,
    main0: [0, 0, 1.3], main8: [5.50293266685089, 16.777717627382597, 0.8320000000000001],
    main16: [22.98133329356934, 19.283628290596177, 0.36400000000000005],
    br04: [13.1208761193383, 23.731549563457254, 0.46345],
    br18: [9.19547790767462, 28.071211253467304, 0.12090000000000002],
  };
  const p = mk({ arcMode: 'arc', arcLengthPx: 30, arcDirDeg: 40, arcDisplace: 0.4, arcBranches: 2, arcWidthPx: 1.3, arcFlicker: 10, arcSeed: 11, arcGrowHz: 0 });
  const s = arcPointsAt(p, 0.57);
  const ptNear = (q: { x: number; y: number; w: number }, v: number[]) =>
    near(q.x, v[0]!, 1e-9) && near(q.y, v[1]!, 1e-9) && near(q.w, v[2]!, 1e-9);
  check('G1 arc 模式采样点与基线逐值一致（alpha/主弧×3/分叉×2）',
    near(s.alpha, BASE.alpha, 1e-9) && s.main.length === 17 && s.branches.length === 2
    && s.branches.every((b) => b.length === 9)
    && ptNear(s.main[0]!, BASE.main0) && ptNear(s.main[8]!, BASE.main8) && ptNear(s.main[16]!, BASE.main16)
    && ptNear(s.branches[0]![4]!, BASE.br04) && ptNear(s.branches[1]![8]!, BASE.br18));
  sameShape('G2 vine 孪生抽查', mk({ arcMode: 'vine', arcLengthPx: 34, arcDirDeg: 300, arcWidthPx: 1.6, arcSeed: 9, arcDetail: 6 }), 0.7);
  sameShape('G3 stars 孪生抽查', mk({ arcMode: 'stars', arcLengthPx: 30, arcSeed: 4, arcDetail: 7 }), 0.45);
  sameShape('G4 beam 孪生抽查', mk({ arcMode: 'beam', arcLengthPx: 40, arcDirDeg: 30, arcWidthPx: 2, arcFlicker: 10, arcSeed: 7 }), 0.35);
  sameShape('G5 glyph 孪生抽查', mk({ arcMode: 'glyph', arcLengthPx: 30, arcWidthPx: 1.4, arcSeed: 3, arcDetail: 12, arcGlyphSpinDeg: 30 }), 1.3);
  sameShape('G6 stream 孪生抽查', mk({ arcMode: 'stream', arcLengthPx: 36, arcWidthPx: 1.6, arcSeed: 5, arcDetail: 6, arcFlowHz: 0.5 }), 0.9);
}

// ---- W 组：消费端接线在位（源码级） ----
console.log('W 组：消费端接线（编辑器分层 / 包内分层 / 编辑器控件）');
{
  const ur = readFileSync(new URL('../src/lib/unified-render.ts', import.meta.url), 'utf8');
  check('W1 编辑器：弧线身后层调用 + ring/fan 分支在位',
    ur.includes("drawDynamicArcs(ctx, instruction, 'back')")
    && ur.includes("drawDynamicArcs(ctx, instruction, 'front')")
    && ur.includes("p.arcMode === 'ring'") && ur.includes("p.arcMode === 'fan'"));
  const rtpl = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
  check('W2 包内：ring 后半环进 backVerts、fan 三角扇在位',
    rtpl.includes("p.arcMode === 'ring'") && rtpl.includes('[backVerts, shape.branches[0]]')
    && rtpl.includes("p.arcMode === 'fan'"));
  const ed = readFileSync(new URL('../src/components/pixel-editor/puppet/DynamicPatternEditor.tsx', import.meta.url), 'utf8');
  check('W3 编辑器控件：环带/扇面选项 + 两新参过滤在位',
    ed.includes('<option value="ring">环带</option>') && ed.includes('<option value="fan">扇面</option>')
    && ed.includes("d.key === 'arcTilt'") && ed.includes("d.key === 'arcFanDeg'"));
}

console.log(`\n结果：${pass} 过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
