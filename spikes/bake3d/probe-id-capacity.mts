/**
 * 特征探针：ID 位掩码容量现状（记录当前行为，不是目标行为）。
 * encodeBoneId/decodeBoneMask 是纯函数，无需 WebGL。
 * 断言全部指向「当前实现是什么样」，供研究稿引用；
 * 若将来扩位落地，本探针的容量断言应当被改写而不是放宽。
 */
import { encodeBoneId, decodeBoneMask } from '../../src/lib/bake/threejs-baker-twopass';

let passed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (!cond) { console.error(`✗ ${name} ${extra}`); process.exit(1); }
  passed++;
  console.log(`✓ ${name}`);
}

// 1) 0..23 往返无损
let roundtrip = true;
for (let i = 0; i <= 23; i++) {
  const [r, g, b] = encodeBoneId(i);
  const dec = decodeBoneMask(r, g, b);
  if (dec.length !== 1 || dec[0] !== i) roundtrip = false;
}
check('编号 0..23 编码/解码往返无损', roundtrip);

// 2) 24 起全部编码为黑（背景），解码为空——Z23 单臂 52 根骨骼场景下 28 根不可编码
let overflowBlack = 0;
for (let i = 24; i < 52; i++) {
  const [r, g, b] = encodeBoneId(i);
  if (r === 0 && g === 0 && b === 0 && decodeBoneMask(r, g, b).length === 0) overflowBlack++;
}
check('编号 24..51 全部编码为黑、解码为空（52 根骨骼的部件有 28 根不可编码）', overflowBlack === 28, `${overflowBlack}/28`);

// 3) 重叠往返：{3, 11, 22} 三骨同像素可同时解出（策略 A 的编码基础成立）
{
  let r = 0, g = 0, b = 0;
  for (const i of [3, 11, 22]) { const [x, y, z] = encodeBoneId(i); r |= x; g |= y; b |= z; }
  const dec = decodeBoneMask(r, g, b);
  check('重叠三骨 {3,11,22} 按位或后可同时解出', JSON.stringify(dec) === JSON.stringify([3, 11, 22]), dec.join(','));
}

// 4) 混合集静默丢位（六部件 ID 遍现行规则的复刻）：过滤集 {5, 30} → 只剩 5 的位，30 无痕迹
{
  let r = 0, g = 0, b = 0;
  for (const li of [5, 30]) {
    if (li < 0 || li > 23) continue; // sixpart 现行写法：越界直接跳过
    const [x, y, z] = encodeBoneId(li); r |= x; g |= y; b |= z;
  }
  const dec = decodeBoneMask(r, g, b);
  check('混合集 {5,30} 现行规则只解出 {5}（30 静默丢失、无警告）', JSON.stringify(dec) === JSON.stringify([5]), dec.join(','));
}

// 5) 双遍顶点染色：单骨主导且编号 ≥24 的顶点 → 纯黑（skeleton-mapper 解 []，三角形无归属）
{
  const [r, g, b] = encodeBoneId(30);
  check('双遍路径编号 30 的顶点 ID 色为纯黑、与背景不可区分', r === 0 && g === 0 && b === 0);
}

console.log(`\nID 容量特征探针全过（${passed} 项，均为当前行为记录）`);
