/**
 * 探针：ID 位掩码 64 位扩位后的口径（PR #41 甲路线落地后改写）。
 * encode/decode 与掩码组装都是纯函数，无需 WebGL。
 * 历史：本探针初版（2026-10-25）记录的是 24 位上限的缺陷行为
 * （24..51 全黑、混合集静默丢位），扩位后断言已全部反转。
 */
import {
  BONE_MASK_BITS, boneMaskSet, decodeBoneMask64, encodeBoneQuad, maskQuad,
} from '../../src/lib/bake/threejs-baker-twopass';

let passed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (!cond) { console.error(`✗ ${name} ${extra}`); process.exit(1); }
  passed++;
  console.log(`✓ ${name}`);
}

const maskOf = (indices: number[]): Uint8Array => {
  const m = new Uint8Array(8);
  for (const i of indices) boneMaskSet(m, i);
  return m;
};

// 1) 0..63 全部往返无损（经两半 quad 传递后仍可解出）
{
  let ok = true;
  for (let i = 0; i < BONE_MASK_BITS; i++) {
    const m = maskOf([i]);
    const bytes = [...maskQuad(m, 0), ...maskQuad(m, 1)];
    const dec = decodeBoneMask64(bytes);
    if (dec.length !== 1 || dec[0] !== i) ok = false;
  }
  check('编号 0..63 编码/两半传递/解码往返无损', ok);
}

// 2) Z23 场景复刻：单部件 52 根骨骼逐根可编码（旧口径下 28 根为黑）
{
  let black = 0;
  for (let i = 0; i < 52; i++) {
    const m = maskOf([i]);
    if (m.every((v) => v === 0)) black++;
  }
  check('52 根骨骼逐根可编码、无一为黑', black === 0, `黑 ${black}`);
}

// 3) 混合集不丢位：{5, 40, 63} 跨低半/高半同时解出
{
  const m = maskOf([5, 40, 63]);
  const dec = decodeBoneMask64([...maskQuad(m, 0), ...maskQuad(m, 1)]);
  check('混合集 {5,40,63} 全部解出（旧口径 40/63 静默丢失）',
    JSON.stringify(dec) === JSON.stringify([5, 40, 63]), dec.join(','));
}

// 4) 单骨 quad：高半 bone 只落在高半、低半为全 0（两半互不串扰）
{
  const lo = encodeBoneQuad(40, 0);
  const hi = encodeBoneQuad(40, 1);
  check('encodeBoneQuad(40,·)：低半全 0、高半含位',
    lo.every((v) => v === 0) && hi.some((v) => v !== 0));
  const lo2 = encodeBoneQuad(7, 0);
  const hi2 = encodeBoneQuad(7, 1);
  check('encodeBoneQuad(7,·)：高半全 0、低半含位',
    hi2.every((v) => v === 0) && lo2.some((v) => v !== 0));
}

// 5) 边界：≥64 不置位（容量边界明确，超出仍为黑——部件骨骼数 >64 时
//    六部件侧有有效骨骼兜底，见 threejs-baker-sixpart 的掩码为空兜底）
{
  const m = maskOf([64, 100]);
  check('编号 ≥64 不置位（容量边界 = 64）', m.every((v) => v === 0));
}

console.log(`\nID 容量探针全过（${passed} 项，64 位新口径）`);
