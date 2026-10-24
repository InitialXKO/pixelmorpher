// ============================================================
// 探针：拆分小碎片清理（2026-10-25，借 3Dto2Dshape 的连通域口径）
// 除最大连通域外，面积 <4 的孤岛整域清除；最大域永不清除；
// 眼/眉/口等小部件骨骼名字豁免。
// 跑法：/opt/hatch-image/bin/bun spikes/bake3d/probe-fragment-filter.mts
// ============================================================

import { filterSmallMaskComponents, isProtectedDetailBone } from '../../src/lib/bake/skeleton-mapper.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};
const W = 12, H = 12;
const mk = () => new Uint8Array(W * H);
const put = (m: Uint8Array, pts: Array<[number, number]>) => { for (const [x, y] of pts) m[y * W + x] = 1; };
const count = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);
const rect = (x0: number, y0: number, w: number, h: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]);
  return out;
};

// 主体 20px + 孤点 2px + 孤点 1px → 清 3，主域不动
{
  const m = mk();
  put(m, rect(0, 0, 5, 4));
  put(m, [[8, 8], [9, 8]]);
  put(m, [[11, 0]]);
  const removed = filterSmallMaskComponents(m, W, H);
  check('孤点清除 3px、主域 20px 全保留', removed === 3 && count(m) === 20, `removed=${removed} left=${count(m)}`);
}
// 只有一块 3px（即最大域）→ 不清
{
  const m = mk();
  put(m, [[3, 3], [4, 3], [3, 4]]);
  const removed = filterSmallMaskComponents(m, W, H);
  check('唯一小域作为最大域保留', removed === 0 && count(m) === 3);
}
// 两块小域 3px + 2px → 清 2px 的，留 3px 的
{
  const m = mk();
  put(m, [[0, 0], [1, 0], [0, 1]]);
  put(m, [[8, 8], [9, 8]]);
  const removed = filterSmallMaskComponents(m, W, H);
  check('次小域清除、最大小域保留', removed === 2 && count(m) === 3 && m[0] === 1);
}
// 8 连通：对角相邻算同一域
{
  const m = mk();
  put(m, rect(0, 0, 3, 3)); // 9 主域
  put(m, [[6, 6], [7, 7]]); // 对角链 = 一个 2px 域
  const removed = filterSmallMaskComponents(m, W, H);
  check('对角相邻算同一连通域（2px 域整清）', removed === 2 && count(m) === 9);
}
// 4px 的域不清（阈值是 <4）
{
  const m = mk();
  put(m, rect(0, 0, 4, 4));
  put(m, rect(8, 8, 2, 2)); // 4px
  const removed = filterSmallMaskComponents(m, W, H);
  check('4px 域保留（阈值 <4）', removed === 0 && count(m) === 20);
}
// minArea=0 关闭
{
  const m = mk();
  put(m, rect(0, 0, 2, 2));
  put(m, [[10, 10]]);
  const removed = filterSmallMaskComponents(m, W, H, 0);
  check('minArea=0 关闭清理', removed === 0 && count(m) === 5);
}
// 豁免名单
{
  check('眼/眉/口豁免', isProtectedDetailBone('左目') && isProtectedDetailBone('Eye_L') && isProtectedDetailBone('口') && isProtectedDetailBone('MouthOpen') && isProtectedDetailBone('眉毛'));
  check('普通骨骼不豁免', !isProtectedDetailBone('上腕.L') && !isProtectedDetailBone('HairBack') && !isProtectedDetailBone('頭'));
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
