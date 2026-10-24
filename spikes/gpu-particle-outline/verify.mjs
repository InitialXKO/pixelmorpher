// 运行时 v3 纯逻辑校验：抽取 index.html 中 PURE 段
// （形状场 / 层语言+bump / 瓦片 / 变体 / 排序 / 程序化引擎 / 蓝图求值 / 包络合成 / 打包）
// 运行：node spikes/gpu-particle-outline/verify.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const begin = html.indexOf('// === PURE BEGIN ===');
const end = html.indexOf('// === PURE END ===');
if (begin < 0 || end < 0) { console.error('未找到 PURE 段'); process.exit(1); }
const src = html.slice(begin, end) +
  '\nexport { turtleToPoints, pointsToSegments, pointInPolygon, shapeField, compileTile, F, bumpValue, packAtlas, mirrorParams, resolveVariantParams, variantMirrored, resolvePart, sortParts, computeProceduralPose, evalBlueprint, envelopeWeight, composePerformance, packInstances, INSTANCE_FLOATS };\n';
const mod = await import('data:text/javascript,' + encodeURIComponent(src));
const { turtleToPoints, pointsToSegments, pointInPolygon, shapeField, compileTile, F, bumpValue, packAtlas, mirrorParams, resolveVariantParams, variantMirrored, resolvePart, sortParts, computeProceduralPose, evalBlueprint, envelopeWeight, composePerformance, packInstances, INSTANCE_FLOATS } = mod;

let fail = 0;
const ok = (n, c, e = '') => { if (!c) fail++; console.log(`${c ? '✓' : '✗ FAIL'} ${n} ${e}`); };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// 基础几何（沿用）
{
  const pts = turtleToPoints([['FD', 10], ['RT', 90], ['FD', 10], ['RT', 90], ['FD', 10], ['RT', 90], ['FD', 10]]);
  ok('turtle 正方形回原点', pts.length === 5 && Math.abs(pts[4][0]) < 1e-9 && Math.abs(pts[4][1]) < 1e-9);
  const segs = pointsToSegments([[0, 0], [10, 0], [10, 10]], [5, 5]);
  ok('枢轴相对化', segs[0][0] === -5 && segs[0][2] === 5);
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  ok('点在多边形内/外', pointInPolygon(5, 5, sq) === true && pointInPolygon(15, 5, sq) === false);
  const rect = { kind: 'rect', size: [11, 14], roundness: 0.35 };
  const c = shapeField(rect, 0, 0), out = shapeField(rect, 10, 0);
  ok('rect 场', c.inside && near(c.d, 5.5) && !out.inside && near(out.d, 4.5));
  const poly = { kind: 'poly', size: [4, 4], points: [[-2, -2], [2, -2], [2, 2], [-2, 2]], pivot: [0, 0] };
  const pc = shapeField(poly, 0, 0), pe = shapeField(poly, 3, 0);
  ok('poly 场', pc.inside && near(pc.d, 2) && !pe.inside && near(pe.d, 1));
}
// 瓦片：档位/外环/glint（沿用）+ bump 形式层
{
  const shape = { kind: 'poly', size: [4, 4], points: [[-2, -2], [2, -2], [2, 2], [-2, 2]], pivot: [0, 0] };
  const R = (t, x, y) => t.data[(y * t.w + x) * 4];
  const G = (t, x, y) => t.data[(y * t.w + x) * 4 + 1];
  const tile = compileTile(shape, [...F.lightGradY([3, 2, 1]), ...F.outlineDark()]);
  ok('瓦片基本', tile.w === 8 && R(tile, 0, 0) === 255 && R(tile, 4, 1) === 254 && R(tile, 3, 3) === 0 && R(tile, 4, 4) === 2);
  const tile2 = compileTile(shape, [...F.lightFlat(2), ...F.glintFace(-135, 80)]);
  ok('glint 候选', G(tile2, 5, 5) === 255 && G(tile2, 3, 3) === 0);
  const rectShape = { kind: 'rect', size: [11, 14], roundness: 0.35 };
  const bt = compileTile(rectShape, [...F.bump('dome'), ...F.outlineDark()]);
  const BR = (x, y) => bt.data[(y * bt.w + x) * 4];
  ok('bump 穹面中心 hi 档 3', BR(bt.cx, bt.cy) === 3, String(BR(bt.cx, bt.cy)));
  ok('bump 穹面下段 mid 档 2', BR(bt.cx, bt.cy + 5) === 2, String(BR(bt.cx, bt.cy + 5)));
  ok('bump 后描边仍压边 0', BR(bt.cx, bt.cy + 6) === 0, String(BR(bt.cx, bt.cy + 6)));
  ok('bumpValue dome/edge', near(bumpValue('dome', { h: 0.8 }), 0.8) && near(bumpValue('edge', { h: 0.8 }), 0.2));
}
// 变体/服装/排序（沿用）
{
  const m = mirrorParams({ pivot: [2, 26], off: [3, -1], poly: [[6, 0], [-1, 2]] });
  ok('mirrorParams', m.pivot[0] === -2 && m.off[0] === -3 && m.poly[0][0] === -6 && m.poly[1][0] === 1);
  const sword = { base: { pivot: [2, 26], off: [2.5, -11], size: [13, 5], poly: [[6, 0]], pal: 'steel' }, variants: { 2: { off: [3.5, -11] } }, costumeKeys: [] };
  const v6 = resolvePart(sword, 6, null);
  ok('西向统一镜像', v6.params.pivot[0] === -2 && v6.params.off[0] === -3.5 && v6.shape.points[0][0] === -6);
  ok('variantMirrored', variantMirrored(sword, 6) === true && variantMirrored(sword, 2) === false);
  const cape = { base: { pivot: [0, 24], size: [15, 17], pal: 'cloak' }, variants: {}, costumeKeys: ['cape'] };
  ok('服装隐藏/覆盖', resolvePart(cape, 0, { cape: null }).params.hidden === true && resolvePart(cape, 0, { cape: { pal: 'scarf' } }).params.pal === 'scarf');
  const parts = [
    { key: 'cape', drawLayer: 'cape', sortOrder: 0 }, { key: 'armF', drawLayer: 'right_arm', sortOrder: 0 },
    { key: 'head', drawLayer: 'head', sortOrder: 0 }, { key: 'armB', drawLayer: 'left_arm', sortOrder: 0 },
  ];
  ok('方向排序', sortParts(parts, 2).map((p) => p.key).join(',') === 'cape,armB,head,armF' &&
    sortParts(parts, 6).map((p) => p.key).join(',') === 'cape,armF,head,armB');
}
// 程序化引擎：角色+参数驱动（无帧/无轨道）
{
  const behavior = {
    gait: { strideAmp: 0.8, armAmp: 0.6, bobAmp: 1.0, breathAmp: 0.3, idleSway: 0, leanAmp: 0, phaseRate: 0, idleRate: 0, airLegSplit: 0.5, airArmRaise: 0.4 },
    roles: { l1: 'legL', l2: 'legR', a1: 'armR', t: 'torso', c: 'spring' },
    springs: { c: { stiffness: 5, damping: 0.9, swayAmp: 0.2, phase: 0, baseA: 0 } },
    attach: { s: { on: 'a1', stiffness: 1000, damping: 0.5 } },
  };
  const state = { phase: Math.PI / 2, springs: {}, attachSprings: {} };
  const pose = computeProceduralPose(behavior, { moveX: 1, grounded: true, speed01: 1, t: 0 }, state, 0.016);
  ok('双腿反相摆动', near(pose.l1.a, 0.8) && near(pose.l2.a, -0.8), `${pose.l1.a} ${pose.l2.a}`);
  ok('躯干 bob', near(pose.t.dy, 1.0), String(pose.t.dy));
  const air = computeProceduralPose(behavior, { moveX: 0, grounded: false, speed01: 0, t: 0 }, { phase: 0, springs: {}, attachSprings: {} }, 0.016);
  ok('腾空分腿', near(air.l1.a, 0.5) && near(air.l2.a, -0.5));
  ok('弹簧朝目标收敛中', pose.c.a < 0 && pose.c.a > -0.2, String(pose.c.a));
  ok('持握跟随已启动', pose.s.a > 0, String(pose.s.a));
}
// 蓝图求值 + 包络 + 表演合成
{
  const graph = { nodes: [
    { id: 't', type: 'time' },
    { id: 'cv', type: 'curve', inputs: ['t'], points: [[0, 0], [0.5, 2], [1, 0]] },
    { id: 'half', type: 'math', op: 'mul', inputs: ['cv'], b: 0.5 },
    { id: 'tr', type: 'transform', part: 'sword', angleFrom: 'half' },
  ] };
  const out = evalBlueprint(graph, { u: 0.5 });
  ok('蓝图曲线→transform', out.get('sword').angle === 1, JSON.stringify([...out]));
  const graphOff = { nodes: [
    { id: 't', type: 'time' },
    { id: 'cv', type: 'curve', inputs: ['t'], points: [[0, 0], [0.5, 2], [1, 0]], enabled: false },
    { id: 'tr', type: 'transform', part: 'sword', angleFrom: 'cv' },
  ] };
  ok('enabled 短路', evalBlueprint(graphOff, { u: 0.5 }).get('sword').angle === 0);
  ok('包络权重', near(envelopeWeight(0.025, 0.45, 0.05, 0.15), 0.5) && envelopeWeight(0.2, 0.45, 0.05, 0.15) === 1 && envelopeWeight(0.45, 0.45, 0.05, 0.15) === 0);
  const pose = { sword: { a: 0.2, dy: 0, rim: 0, glint: 0 }, leg: { a: 0.3, dy: 0, rim: 0, glint: 0 } };
  const bp = new Map([['sword', { angle: 1.0 }]]);
  const over = composePerformance(pose, { mask: ['sword'], mode: 'override' }, bp, 0.5);
  ok('接管合成（掩码内混合、掩码外不动）', near(over.sword.a, 0.6) && over.leg.a === 0.3, `${over.sword.a}`);
  const add = composePerformance(pose, { mask: ['sword'], mode: 'add' }, bp, 0.5);
  ok('加算合成', near(add.sword.a, 0.7), String(add.sword.a));
}
// 图集与打包（含 ghost 位）
{
  const { placements } = packAtlas([{ w: 10, h: 10 }, { w: 6, h: 6 }], 16);
  ok('图集打包', placements[0][0] === 0 && placements[1][0] === 10);
  const el = { pos: [1, 2], size: [3, 4], rot: 45, tileCx: 5, tileCy: 6, tile: [7, 8, 9, 10], family: 3, seed: 0.5, modes: [2, 1, 3, 5], param: [0.1, 0.2, 0.3], ghost: true };
  const buf = packInstances([el]);
  ok('打包 19 float + modes + ghost', buf.length === 19 && INSTANCE_FLOATS === 19 && buf[13] === 2762 && buf[18] === 1 && near(buf[15], 0.1, 1e-6),
    Array.from(buf).join(','));
}

console.log(fail === 0 ? '运行时 v3 纯逻辑校验全过' : `${fail} 项失败`);
process.exit(fail ? 1 : 0);
