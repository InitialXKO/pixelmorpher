// 原型纯逻辑校验：抽取 index.html 中 PURE 段（轮廓编译/打包/排序/量化）在 Node 下验证
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
  '\nexport { turtleToPoints, pointsToSegments, compileOutlines, quantize1, sortByLayer, packInstances, INSTANCE_FLOATS, MAX_SEG, MAX_OUTLINES };\n';
const mod = await import('data:text/javascript,' + encodeURIComponent(src));
const { turtleToPoints, pointsToSegments, compileOutlines, quantize1, sortByLayer, packInstances, INSTANCE_FLOATS } = mod;

let fail = 0;
const ok = (n, c, e = '') => { if (!c) fail++; console.log(`${c ? '✓' : '✗ FAIL'} ${n} ${e}`); };

// turtle：走正方形（边长 10）→ 回到原点，4 条边
{
  const pts = turtleToPoints([['FD', 10], ['RT', 90], ['FD', 10], ['RT', 90], ['FD', 10], ['RT', 90], ['FD', 10]]);
  ok('turtle 正方形 5 点', pts.length === 5, String(pts.length));
  ok('turtle 回到原点', Math.abs(pts[4][0]) < 1e-9 && Math.abs(pts[4][1]) < 1e-9, JSON.stringify(pts[4]));
  const segs = pointsToSegments(pts.slice(0, 4), [0, 0]);
  ok('正方形 4 段闭合', segs.length === 4 && segs[0][0] === 0 && segs[0][2] === 10, JSON.stringify(segs[0]));
}
// 枢轴相对化
{
  const segs = pointsToSegments([[0, 0], [10, 0], [10, 10]], [5, 5]);
  ok('枢轴相对化', segs[0][0] === -5 && segs[0][1] === -5 && segs[0][2] === 5 && segs[0][3] === -5, JSON.stringify(segs[0]));
}
// 编译：两轮廓，计数与数据落点
{
  const { data, counts } = compileOutlines([
    { points: [[0, 0], [4, 0], [4, 4], [0, 4]], pivot: [2, 2] },
    { points: [[0, 0], [6, 0], [3, 5]], pivot: [3, 0] },
  ]);
  ok('线段计数 [4,3]', counts[0] === 4 && counts[1] === 3, counts.join(','));
  const o = (1 * 32 + 0) * 4;
  ok('第二轮廓首段落点', data[o] === -3 && data[o + 1] === 0 && data[o + 2] === 3 && data[o + 3] === 0,
    [data[o], data[o + 1], data[o + 2], data[o + 3]].join(','));
  let threw = false;
  try { compileOutlines(Array.from({ length: 9 }, () => ({ points: [[0, 0], [1, 0]], pivot: [0, 0] }))); } catch { threw = true; }
  ok('超轮廓上限报错', threw);
}
// 量化与排序
ok('量化', quantize1(2.4) === 2 && quantize1(2.5) === 3 && quantize1(-1.5) === -1);
{
  const els = [{ layer: 2, id: 'a' }, { layer: -1, id: 'b' }, { layer: 2, id: 'c' }, { layer: 0, id: 'd' }];
  const s = sortByLayer(els).map((e) => e.id).join('');
  ok('layer 稳定排序', s === 'bdac', s);
}
// 打包布局
{
  const el = { pos: [1, 2], size: [3, 4], rot: 45, pivot: [5, 6], outline: 1, pattern: 2, palette: 8, seed: 9, param: [10, 11, 12, 13], motion: [14, 15] };
  const buf = packInstances([el]);
  ok('打包长度 17', buf.length === INSTANCE_FLOATS && INSTANCE_FLOATS === 17);
  ok('打包字段', buf[0] === 1 && buf[4] === 45 && buf[7] === 1 && buf[9] === 8 && buf[13] === 12 && buf[16] === 15,
    Array.from(buf).join(','));
}

console.log(fail === 0 ? '原型纯逻辑校验全过' : `${fail} 项失败`);
process.exit(fail ? 1 : 0);
