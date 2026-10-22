// 原型纯逻辑校验：抽取 index.html 中 PURE 段（轮廓编译 / pattern 语言 → mask / 图集 / 打包）在 Node 下验证
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
  '\nexport { turtleToPoints, pointsToSegments, pointInPolygon, compileMask, F, packAtlas, quantize1, sortByLayer, packInstances, INSTANCE_FLOATS };\n';
const mod = await import('data:text/javascript,' + encodeURIComponent(src));
const { turtleToPoints, pointsToSegments, pointInPolygon, compileMask, F, packAtlas, quantize1, sortByLayer, packInstances, INSTANCE_FLOATS } = mod;

let fail = 0;
const ok = (n, c, e = '') => { if (!c) fail++; console.log(`${c ? '✓' : '✗ FAIL'} ${n} ${e}`); };

// turtle 与线段（沿用）
{
  const pts = turtleToPoints([['FD', 10], ['RT', 90], ['FD', 10], ['RT', 90], ['FD', 10], ['RT', 90], ['FD', 10]]);
  ok('turtle 正方形回原点', pts.length === 5 && Math.abs(pts[4][0]) < 1e-9 && Math.abs(pts[4][1]) < 1e-9);
  const segs = pointsToSegments([[0, 0], [10, 0], [10, 10]], [5, 5]);
  ok('枢轴相对化', segs[0][0] === -5 && segs[0][2] === 5, JSON.stringify(segs[0]));
}
// 点在多边形内
{
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  ok('点在多边形内/外', pointInPolygon(5, 5, sq) === true && pointInPolygon(15, 5, sq) === false && pointInPolygon(5, -1, sq) === false);
}
// pattern 程序 → mask：8×8 瓦片内嵌 4×4 方形（相对枢轴 -2..2）
const SQ = { points: [[2, 2], [6, 2], [6, 6], [2, 6]], pivot: [4, 4], w: 8, h: 8 };
const slotAt = (mask, x, y) => mask[(y * SQ.w + x) * 4];
const gAt = (mask, x, y) => mask[(y * SQ.w + x) * 4 + 1];
{
  const segs = pointsToSegments(SQ.points, SQ.pivot);
  const mask = compileMask(SQ.points, segs, SQ.w, SQ.h, SQ.pivot, [...F.lightGradY([3, 2, 1]), ...F.outlineDark()]);
  ok('外部透明', slotAt(mask, 0, 0) === 255, String(slotAt(mask, 0, 0)));
  ok('上沿描边 slot 0', slotAt(mask, 4, 2) === 0, String(slotAt(mask, 4, 2)));
  ok('上段渐变 slot 2', slotAt(mask, 4, 3) === 2, String(slotAt(mask, 4, 3)));
  ok('中段 slot 2', slotAt(mask, 4, 4) === 2, String(slotAt(mask, 4, 4)));
  ok('下沿像素属描边带 slot 0', slotAt(mask, 4, 5) === 0, String(slotAt(mask, 4, 5)));
  ok('外扩 0.5 环被描边覆盖', slotAt(mask, 4, 6) === 0, String(slotAt(mask, 4, 6)));
  // 高形状里渐变下段 slot 1 才露得出（4px 矮形状下段全在描边带内）
  const TALL = { points: [[1, 1], [7, 1], [7, 13], [1, 13]], pivot: [4, 7], w: 8, h: 14 };
  const segsT = pointsToSegments(TALL.points, TALL.pivot);
  const maskT = compileMask(TALL.points, segsT, TALL.w, TALL.h, TALL.pivot, [...F.lightGradY([3, 2, 1]), ...F.outlineDark()]);
  ok('高形状下段渐变 slot 1', maskT[(11 * TALL.w + 4) * 4] === 1, String(maskT[(11 * TALL.w + 4) * 4]));
}
{
  const segs = pointsToSegments(SQ.points, SQ.pivot);
  const mask = compileMask(SQ.points, segs, SQ.w, SQ.h, SQ.pivot,
    [...F.lightFlat(2), ...F.rim(-135, 4, 1.8, 70), ...F.outlineDark()]);
  ok('rim 背光缘（中心像素梯度向 -135°）slot 4', slotAt(mask, 4, 4) === 4, String(slotAt(mask, 4, 4)));
  const mask2 = compileMask(SQ.points, segs, SQ.w, SQ.h, SQ.pivot, [...F.lightFlat(2), ...F.glintFace(45, 80)]);
  ok('glint 候选写 G（迎光内侧）', gAt(mask2, 3, 3) === 255, String(gAt(mask2, 3, 3)));
  ok('glint 候选不写背光侧', gAt(mask2, 4, 4) === 0, String(gAt(mask2, 4, 4)));
}
// 量化/排序/打包（布局 v3：tile 在 7/8，pattern 保留位 9 恒 0，motion 在 17/18）
ok('量化', quantize1(2.4) === 2 && quantize1(2.5) === 3 && quantize1(-1.5) === -1);
{
  const els = [{ layer: 2, id: 'a' }, { layer: -1, id: 'b' }, { layer: 2, id: 'c' }, { layer: 0, id: 'd' }];
  ok('layer 稳定排序', sortByLayer(els).map((e) => e.id).join('') === 'bdac');
  const { placements } = packAtlas([{ w: 10, h: 10 }, { w: 6, h: 6 }], 16);
  ok('图集打包', placements[0][0] === 0 && placements[1][0] === 10 && placements[1][1] === 0, JSON.stringify(placements));
  const el = { pos: [1, 2], size: [3, 4], rot: 45, pivot: [5, 6], tile: [7, 8], pattern: 0, palette: 16, seed: 9, param: [10, 11, 12, 13], motion: [14, 15] };
  const buf = packInstances([el]);
  ok('打包 19 float', buf.length === 19 && INSTANCE_FLOATS === 19);
  ok('打包字段', buf[7] === 7 && buf[8] === 8 && buf[9] === 0 && buf[10] === 16 && buf[16] === 13 && buf[17] === 14 && buf[18] === 15,
    Array.from(buf).join(','));
}

console.log(fail === 0 ? '原型纯逻辑校验全过' : `${fail} 项失败`);
process.exit(fail ? 1 : 0);
