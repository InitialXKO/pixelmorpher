// 合流版纯逻辑校验：抽取 index.html 中 PURE 段（形状场 / pattern 层语言 → 瓦片 / 变体推导 / 排序 / 打包）
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
  '\nexport { turtleToPoints, pointsToSegments, pointInPolygon, shapeField, compileTile, F, packAtlas, mirrorParams, resolveVariantParams, variantMirrored, resolvePart, sortParts, packInstances, INSTANCE_FLOATS };\n';
const mod = await import('data:text/javascript,' + encodeURIComponent(src));
const { turtleToPoints, pointsToSegments, pointInPolygon, shapeField, compileTile, F, packAtlas, mirrorParams, resolveVariantParams, variantMirrored, resolvePart, sortParts, packInstances, INSTANCE_FLOATS } = mod;

let fail = 0;
const ok = (n, c, e = '') => { if (!c) fail++; console.log(`${c ? '✓' : '✗ FAIL'} ${n} ${e}`); };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// turtle / 折线 / 点在多边形（沿用）
{
  const pts = turtleToPoints([['FD', 10], ['RT', 90], ['FD', 10], ['RT', 90], ['FD', 10], ['RT', 90], ['FD', 10]]);
  ok('turtle 正方形回原点', pts.length === 5 && Math.abs(pts[4][0]) < 1e-9 && Math.abs(pts[4][1]) < 1e-9);
  const segs = pointsToSegments([[0, 0], [10, 0], [10, 10]], [5, 5]);
  ok('枢轴相对化', segs[0][0] === -5 && segs[0][2] === 5);
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  ok('点在多边形内/外', pointInPolygon(5, 5, sq) === true && pointInPolygon(15, 5, sq) === false);
}
// 形状场：图元与多边形同口径
{
  const rect = { kind: 'rect', size: [11, 14], roundness: 0.35 };
  const c = shapeField(rect, 0, 0);
  ok('rect 中心在内、d=5.5', c.inside && near(c.d, 5.5), JSON.stringify(c));
  const out = shapeField(rect, 10, 0);
  ok('rect 外点 d=4.5', !out.inside && near(out.d, 4.5), JSON.stringify(out));
  const ell = shapeField({ kind: 'ellipse', size: [2.5, 3] }, 1.25, 0);
  ok('ellipse 边界点', ell.inside && ell.d < 0.01, JSON.stringify(ell));
  const cap = shapeField({ kind: 'capsule', size: [3, 11] }, 0, 7);
  ok('capsule 端外 d=1.5', !cap.inside && near(cap.d, 1.5), JSON.stringify(cap));
  const poly = { kind: 'poly', size: [4, 4], points: [[-2, -2], [2, -2], [2, 2], [-2, 2]], pivot: [0, 0] };
  const pc = shapeField(poly, 0, 0), pe = shapeField(poly, 3, 0);
  ok('poly 中心/外点', pc.inside && near(pc.d, 2) && !pe.inside && near(pe.d, 1), `${JSON.stringify(pc)} ${JSON.stringify(pe)}`);
}
// 瓦片编译：多边形（档位/外环/glint 候选）
{
  const shape = { kind: 'poly', size: [4, 4], points: [[-2, -2], [2, -2], [2, 2], [-2, 2]], pivot: [0, 0] };
  const R = (t, x, y) => t.data[(y * t.w + x) * 4];
  const tile = compileTile(shape, [...F.lightGradY([3, 2, 1]), ...F.outlineDark()]);
  ok('瓦片尺寸 8×8、中心 (4,4)', tile.w === 8 && tile.h === 8 && tile.cx === 4 && tile.cy === 4);
  ok('远角透明 255', R(tile, 0, 0) === 255, String(R(tile, 0, 0)));
  ok('外环 254', R(tile, 4, 1) === 254, String(R(tile, 4, 1)));
  ok('边内侧描边 0', R(tile, 3, 3) === 0, String(R(tile, 3, 3)));
  ok('中心渐变档 2', R(tile, 4, 4) === 2, String(R(tile, 4, 4)));
  const G = (t, x, y) => t.data[(y * t.w + x) * 4 + 1];
  const tile2 = compileTile(shape, [...F.lightFlat(2), ...F.glintFace(-135, 80)]);
  ok('glint 候选写 G（右下内侧）', G(tile2, 5, 5) === 255, String(G(tile2, 5, 5)));
  ok('glint 候选不写左上内侧', G(tile2, 3, 3) === 0, String(G(tile2, 3, 3)));
  const tile3 = compileTile(shape, [...F.lightFlat(2)]);
  ok('无 glint 层时 G 全放行', G(tile3, 4, 4) === 255, String(G(tile3, 4, 4)));
}
// 瓦片编译：图元（rect 同程序同口径）
{
  const shape = { kind: 'rect', size: [11, 14], roundness: 0.35 };
  const tile = compileTile(shape, [...F.lightGradY([3, 2, 1]), ...F.outlineDark()]);
  const R = (x, y) => tile.data[(y * tile.w + x) * 4];
  ok('rect 瓦片 15×18', tile.w === 15 && tile.h === 18, `${tile.w}×${tile.h}`);
  ok('rect 中心档 2', R(tile.cx, tile.cy) === 2, String(R(tile.cx, tile.cy)));
  ok('rect 顶边描边 0', R(tile.cx, tile.cy - 7) === 0, String(R(tile.cx, tile.cy - 7)));
  ok('rect 远角 255', R(0, 0) === 255, String(R(0, 0)));
}
// 变体推导与统一镜像
{
  const m = mirrorParams({ pivot: [2, 26], off: [3, -1], poly: [[6, 0], [-1, 2]] });
  ok('mirrorParams 翻 pivot/off/poly', m.pivot[0] === -2 && m.off[0] === -3 && m.poly[0][0] === -6 && m.poly[1][0] === 1);
  const sword = {
    base: { pivot: [2, 26], off: [2.5, -11], size: [13, 5], poly: [[6, 0]], pal: 'steel' },
    variants: { 2: { off: [3.5, -11] } }, costumeKeys: [],
  };
  const v2 = resolvePart(sword, 2, null);
  ok('东向变体不镜像', v2.params.pivot[0] === 2 && v2.params.off[0] === 3.5 && v2.shape.points[0][0] === 6);
  const v6 = resolvePart(sword, 6, null);
  ok('西向统一镜像（pivot/off/poly 全翻）', v6.params.pivot[0] === -2 && v6.params.off[0] === -3.5 && v6.shape.points[0][0] === -6,
    JSON.stringify([v6.params.pivot, v6.params.off, v6.shape.points]));
  ok('variantMirrored 判定', variantMirrored(sword, 6) === true && variantMirrored(sword, 2) === false && variantMirrored(sword, 0) === false && variantMirrored(sword, 4) === true);
  const cape = { base: { pivot: [0, 24], size: [15, 17], pal: 'cloak' }, variants: {}, costumeKeys: ['cape'] };
  const hidden = resolvePart(cape, 0, { cape: null });
  ok('服装 null 隐藏部件', hidden.params.hidden === true);
  const shown = resolvePart(cape, 0, { cape: { pal: 'scarf' } });
  ok('服装覆盖 pal', shown.params.pal === 'scarf' && !shown.params.hidden);
}
// 方向排序
{
  const parts = [
    { key: 'cape', drawLayer: 'cape', sortOrder: 0 }, { key: 'armF', drawLayer: 'right_arm', sortOrder: 0 },
    { key: 'head', drawLayer: 'head', sortOrder: 0 }, { key: 'armB', drawLayer: 'left_arm', sortOrder: 0 },
  ];
  const o2 = sortParts(parts, 2).map((p) => p.key).join(',');
  const o6 = sortParts(parts, 6).map((p) => p.key).join(',');
  ok('东向：右臂在头之后', o2 === 'cape,armB,head,armF', o2);
  ok('西向：右臂在头之前', o6 === 'cape,armF,head,armB', o6);
}
// 图集与打包（modes 打包在 13）
{
  const { placements } = packAtlas([{ w: 10, h: 10 }, { w: 6, h: 6 }], 16);
  ok('图集打包', placements[0][0] === 0 && placements[1][0] === 10 && placements[1][1] === 0);
  const el = { pos: [1, 2], size: [3, 4], rot: 45, tileCx: 5, tileCy: 6, tile: [7, 8, 9, 10], family: 3, seed: 0.5, modes: [2, 1, 3, 5], param: [0.1, 0.2, 0.3] };
  const buf = packInstances([el]);
  ok('打包 19 float', buf.length === 19 && INSTANCE_FLOATS === 19);
  ok('打包字段', buf[5] === 5 && buf[7] === 7 && buf[10] === 10 && buf[11] === 3 && buf[13] === 2 + 8 + 192 + 2560 && near(buf[15], 0.1, 1e-6) && near(buf[17], 0.3, 1e-6),
    Array.from(buf).join(','));
}

console.log(fail === 0 ? '合流版纯逻辑校验全过' : `${fail} 项失败`);
process.exit(fail ? 1 : 0);
