// verify-package-particle-trajectory.mts — 包内粒子轨迹升级探针（bun 运行）
// 口径（与编辑器侧 dynamic-pattern-sim 同合同）：地面分段弹跳/落定
// （段内公式不变、骨架抛物线交点二次求根、vy'=−vy×bounce、vx'×0.7、
// |vy'|<restVel 或 bounce=0 落定冻结、弹跳 ≤16）；死后链粒子 cls=1
// （死亡状态派生、窗 [life, life+chainLife)、puff）；首次落地派生
// cls=2（落点发射器、窗 landEmitDuration、只一代）；rot 与产品侧
// 同式：spin×龄×哈希符号（盐 71）+ 哈希初相×360（盐 72）。
// 本探针只验包侧：无地面与旧基线公式逐值一致、弹跳采样点与数值
// 积分参考 ≤1px、链/落地窗口与 cls、落定冻结、确定性与上限。
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const dyn = createDynamicRuntime() as unknown as {
  dynSimulate: (i: never, t: never, f: number, fr: number, l: string, s: string) =>
    { x: number; y: number; size: number; alpha: number; color: string; shape: string; dirX: number; dirY: number; cls: number; rot: number }[];
};

// 与 dynamic-src 内 dynHash01 / dynSeedOf 同式（探针侧复制，用于
// 预测每颗粒子的哈希抖动/相位）
function hash01(a?: number, b?: number, c?: number, d?: number): number {
  let h = 2166136261;
  const mix = (n?: number) => { if (n === undefined) return; h ^= (n | 0) + 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 16777619); };
  mix(a); mix(b); mix(c); mix(d);
  h ^= h >>> 13; h = Math.imul(h, 16777619); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function seedOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

// 20×20 实心瓦片（R<128 为占据），plug 在中心
const tileData = new Uint8Array(20 * 20 * 4);
for (let q = 0; q < 400; q++) tileData[q * 4] = 2;
const tile20 = { w: 20, h: 20, cx: 10, cy: 10, data: tileData };

type P = Record<string, unknown>;
function baseParams(over: P = {}): P {
  return {
    emitEnabled: true, rate: 60, life: 1, source: 'plug', layer: 'front', frontRatio: 0.5,
    maxParticles: 500, linkToDeform: 0, directionDeg: -90, speed: 40, spreadDeg: 0,
    turbulence: 0, rise: 0, buoy: 0, sizeStart: 4, sizeEnd: 2, alpha: 0.9,
    color: '#ffaa33', particleShape: 'dot', emitMode: 'out', gatherRadius: 0,
    ...over,
  };
}
function sim(params: P, frame: number, seedKey = 'part', id = 'dyn_t1') {
  return dyn.dynSimulate({ id, slot: 's', params } as never, tile20 as never, frame, 60, 'front', seedKey);
}

// 旧基线（轨迹升级前 dynSimulate 的位置/包络公式）在 plug 源、
// 无后期/无坡道/无形变联动配置下的复刻——A 组逐值对拍基准
function baseline(params: P, frame: number, seedKey: string, id: string) {
  const seedBase = seedOf(`${seedKey}|${id}`);
  const fr = 60;
  const lifeFrames = (params.life as number) * fr;
  const firstBirth = Math.max(0, Math.ceil(frame - lifeFrames));
  const lastBirth = Math.floor(frame);
  const dirRad = (params.directionDeg as number) * Math.PI / 180;
  const dirX = Math.cos(dirRad), dirY = Math.sin(dirRad);
  const out: { x: number; y: number; size: number; alpha: number; color: string; shape: string; dirX: number; dirY: number }[] = [];
  for (let b = lastBirth; b >= firstBirth; b--) {
    const expected = (params.rate as number) / fr;
    let n = Math.floor(expected);
    if (hash01(seedBase, b, 991) < expected - n) n++;
    const age = (frame - b) / fr;
    const lifeRatio = age / (params.life as number);
    if (lifeRatio < 0 || lifeRatio >= 1) continue;
    for (let k = 0; k < n; k++) {
      const jx = hash01(seedBase, b, k, 21) - 0.5;
      const jy = hash01(seedBase, b, k, 22) - 0.5;
      const sx = jx, sy = jy; // plug 点：pt=(cx-0.5, cy-0.5)，sx=pt.x+0.5+jx-cx=jx
      const spread = (hash01(seedBase, b, k, 31) - 0.5) * (params.spreadDeg as number) * Math.PI / 180;
      let vx = dirX * (params.speed as number);
      let vy = dirY * (params.speed as number) + -1 * (params.speed as number) * 0.5;
      const cs = Math.cos(spread), sn = Math.sin(spread);
      const nvx = vx * cs - vy * sn, nvy = vx * sn + vy * cs;
      vx = nvx; vy = nvy;
      const sway = (params.turbulence as number) * Math.sin(age * 3.1 + hash01(seedBase, b, k, 41) * Math.PI * 2) * Math.min(1, age);
      const px = sx + vx * age + sway * -vy * 0.14;
      const py = sy + vy * age - (params.rise as number) * age - 0.5 * (params.buoy as number) * age * age + sway * vx * 0.14;
      const size = (params.sizeStart as number) + ((params.sizeEnd as number) - (params.sizeStart as number)) * lifeRatio;
      const env = lifeRatio < 0.15 ? lifeRatio / 0.15 : 1 - (lifeRatio - 0.15) / 0.85;
      const alpha = Math.max(0, (params.alpha as number) * env);
      const vlen = Math.hypot(vx, vy);
      out.push({
        x: px, y: py, size, alpha, color: params.color as string, shape: (params.particleShape as string) || 'dot',
        dirX: vlen > 1e-6 ? vx / vlen : dirX, dirY: vlen > 1e-6 ? vy / vlen : dirY,
      });
      if (out.length >= (params.maxParticles as number)) return out;
    }
  }
  return out;
}

// ---------- A) 无地面 = 旧基线逐值一致 ----------
{
  const params = baseParams({
    life: 1.2, speed: 40, directionDeg: -90, spreadDeg: 30, turbulence: 3, rise: 12, buoy: -140,
    sizeStart: 5, sizeEnd: 2,
  });
  const seedBaseA = seedOf('part|dyn_t1');
  // 与 exp 同序（出生帧降序）的存活出生帧表（rate=帧率 → 每帧
  // n=1、k=0），供逐粒核 rot 的哈希初相
  const aliveBirths = (f: number) => {
    const arr: number[] = [];
    for (let b = f; b >= 0; b--) if ((f - b) / 60 < 1.2) arr.push(b);
    return arr;
  };
  let okAll = true, witness = 0;
  for (const f of [10, 37, 80]) {
    const got = sim(params, f);
    const exp = baseline(params, f, 'part', 'dyn_t1');
    if (got.length !== exp.length) okAll = false;
    else {
      const alive = aliveBirths(f);
      for (let i = 0; i < exp.length; i++) {
        const g = got[i]!, e = exp[i]!;
        if (!near(g.x, e.x, 1e-9) || !near(g.y, e.y, 1e-9) || !near(g.size, e.size, 1e-9)
          || !near(g.alpha, e.alpha, 1e-9) || g.color !== e.color || g.shape !== e.shape
          || !near(g.dirX, e.dirX, 1e-9) || !near(g.dirY, e.dirY, 1e-9)) okAll = false;
        if (g.cls !== 0) okAll = false;
        // rot：本组 spinDeg 未设（=0），只剩哈希初相一项
        const bI = alive[i];
        if (bI === undefined || !near(g.rot, hash01(seedBaseA, bI, 0, 72) * 360, 1e-9)) okAll = false;
      }
    }
    if (got.length > 0) witness++;
  }
  check('A1 无地面与旧基线逐值一致（x/y/size/alpha/color/shape/dir/rot）', okAll && witness === 3);
  // 地面开启但远在下方（永不落地）→ 分段路径单段 = 基线
  const far = baseParams({
    life: 1.2, speed: 40, directionDeg: -90, spreadDeg: 30, turbulence: 3, rise: 12, buoy: -140,
    sizeStart: 5, sizeEnd: 2, groundEnabled: true, groundYPx: 100000, bounce: 0.5, restVelPx: 10,
  });
  let okFar = true;
  for (const f of [10, 37, 80]) {
    const got = sim(far, f);
    const exp = baseline(params, f, 'part', 'dyn_t1');
    if (got.length !== exp.length) okFar = false;
    else for (let i = 0; i < exp.length; i++) {
      if (!near(got[i]!.x, exp[i]!.x, 1e-9) || !near(got[i]!.y, exp[i]!.y, 1e-9)) okFar = false;
    }
  }
  check('A2 地面开启但未落地时与基线逐值一致', okFar);
}

// ---------- B) 弹跳 vs 数值积分参考（≤1px） ----------
// plug 源、spread/turbulence=0：全粒子共用同一骨架轨迹（仅出生
// 抖动 (jx,jy) 不同，探针以哈希预测之）。骨架：vy0=15、重力
// 900（buoy=-900）、地面 y=8、bounce 0.5、restVel 40（两跳后落定）。
function refTraj(jx: number, jy: number, age: number) {
  const dt = 1 / 4800;
  let x = jx, y = jy, vx = 0, v = 15, rest = false;
  const steps = Math.round(age / dt);
  for (let i = 0; i < steps; i++) {
    if (rest) break;
    v += 900 * dt;
    x += vx * dt;
    y += v * dt;
    if (y >= 8 && v > 0) {
      y = 8;
      v = -v * 0.5;
      vx *= 0.7;
      if (Math.abs(v) < 40) rest = true;
    }
  }
  return { x, y };
}
{
  const params = baseParams({
    life: 2, speed: 30, directionDeg: 90, buoy: -900,
    sizeStart: 4, sizeEnd: 4, alpha: 1,
    groundEnabled: true, groundYPx: 8, bounce: 0.5, restVelPx: 40,
  });
  const seedBase = seedOf('part|dyn_t1');
  let okTraj = true, compared = 0;
  for (const f of [20, 26, 33, 45, 70]) {
    const got = sim(params, f).filter((p) => p.cls === 0);
    // 出生帧 b ∈ [f-120, f]（life 2s），每帧 n=1（rate=帧率）
    let expectCount = 0;
    for (let b = Math.max(0, f - 120); b <= f; b++) {
      const age = (f - b) / 60;
      if (age >= 2) continue;
      expectCount++;
      const jx = hash01(seedBase, b, 0, 21) - 0.5;
      const jy = hash01(seedBase, b, 0, 22) - 0.5;
      const ref = refTraj(jx, jy, age);
      const hit = got.some((p) => Math.abs(p.x - ref.x) <= 1 && Math.abs(p.y - ref.y) <= 1);
      if (!hit) okTraj = false;
      compared++;
    }
    if (got.length !== expectCount) okTraj = false;
  }
  check(`B1 弹跳采样点与数值积分参考 ≤1px（${compared} 点）`, okTraj && compared > 100);
  check('B2 无链/落地配置下不出派生粒子', sim(params, 70).every((p) => p.cls === 0));
}

// ---------- C) 落定冻结 ----------
{
  const params = baseParams({
    life: 3, speed: 30, directionDeg: 90, buoy: -900,
    sizeStart: 4, sizeEnd: 4, alpha: 1,
    groundEnabled: true, groundYPx: 8, bounce: 0.3, restVelPx: 200,
  });
  const seedBase = seedOf('part|dyn_t1');
  const jx20 = hash01(seedBase, 20, 0, 21) - 0.5;
  const at = (f: number) => sim(params, f).filter((p) => p.cls === 0 && p.y === 8 && near(p.x, jx20, 1e-9));
  check('C1 落定后位置冻结于 (jx, groundY) 且跨帧不变', at(100).length === 1 && at(140).length === 1);
}

// ---------- D) 死后链粒子 ----------
{
  const params = baseParams({
    life: 0.5, speed: 50, directionDeg: -90, sizeEnd: 3,
    chainEnabled: true, chainLife: 0.4, chainSizeMul: 2, chainColor: '#33ccff',
  });
  const seedBase = seedOf('part|dyn_t1');
  const early = sim(params, 20);
  check('D1 父未死时无链粒子', early.every((p) => p.cls !== 1));
  const got = sim(params, 65);
  const chains = got.filter((p) => p.cls === 1);
  // 链窗：age∈[0.5,0.9) → b∈[12,35]，每 b 一粒（n=1）
  check('D2 链粒子数 = 窗内出生帧数（24）', chains.length === 24);
  check('D3 链粒子 shape=puff、color=chainColor、尺寸 ∈ [sizeEnd×mul, ×1.5]',
    chains.every((p) => p.shape === 'puff' && p.color === '#33ccff' && p.size >= 6 - 1e-9 && p.size <= 9 + 1e-9));
  // b=35 的父恰于本帧死亡：链龄 0 → 链粒子 = 死亡点（jx, jy−75×0.5）
  const jx35 = hash01(seedBase, 35, 0, 21) - 0.5;
  const jy35 = hash01(seedBase, 35, 0, 22) - 0.5;
  check('D4 链龄 0 的链粒子位于父死亡点、尺寸 = sizeEnd×mul',
    chains.some((p) => near(p.x, jx35, 1e-9) && near(p.y, jy35 - 37.5, 1e-9) && near(p.size, 6, 1e-9)));
  // 发射持续不断：200 帧仍有新父死亡派生链粒子，但链龄恒
  // < chainLife（尺寸 = 6×(1+0.5×链龄比) < 9 为判据）
  const late = sim(params, 200).filter((p) => p.cls === 1);
  check('D5 链粒子链龄恒 < chainLife（尺寸判据）',
    late.length > 0 && late.every((p) => p.size >= 6 - 1e-9 && p.size < 9));
}

// ---------- E) 落地派生 ----------
{
  const params = baseParams({
    life: 1, speed: 30, directionDeg: 90, buoy: -900,
    sizeStart: 4, sizeEnd: 4, alpha: 1,
    groundEnabled: true, groundYPx: 8, bounce: 0.5, restVelPx: 40,
    landEmitEnabled: true, landEmitRate: 120, landEmitDuration: 0.3,
    landEmitColor: '#ffee55', landEmitRise: 80,
  });
  check('E1 落地前无落地派生粒子', sim(params, 3).every((p) => p.cls !== 2));
  const got = sim(params, 50).filter((p) => p.cls === 2);
  check('E2 落地后出现 cls=2 且 color/shape 合合同',
    got.length > 0 && got.every((p) => p.color === '#ffee55' && p.shape === 'dot'));
  // 地面不可达（粒子永不落地）→ 无发射器 → 无 cls=2
  check('E3 永不落地则无 cls=2', sim({ ...params, groundYPx: -100000 }, 50).every((p) => p.cls !== 2));
  // 派生窗收窄（0.3→0.05）→ cls=2 显著变少（窗确实在门控）
  const wide = sim(params, 50).filter((p) => p.cls === 2).length;
  const narrow = sim({ ...params, landEmitDuration: 0.05 }, 50).filter((p) => p.cls === 2).length;
  check('E3b 派生窗收窄使 cls=2 变少', narrow < wide);
  const noLand = sim({ ...params, landEmitEnabled: false }, 50);
  check('E4 landEmitEnabled 关 → 无 cls=2', noLand.every((p) => p.cls !== 2));
}

// ---------- F) cls/rot 字段面 ----------
{
  const params = baseParams({
    life: 1.2, speed: 40, directionDeg: -90, spreadDeg: 30, turbulence: 3, rise: 12, buoy: -140,
    particleShape: 'shard', particleSpinDeg: 120,
  });
  const got = sim(params, 50);
  check('F1 全部粒子带 cls/rot、shape 透传 shard',
    got.length > 0 && got.every((p) => p.cls === 0 && typeof p.rot === 'number' && p.shape === 'shard'));
  // rot 与产品侧同式：spin×龄×哈希符号（盐 71）+ 哈希初相
  // （盐 72）×360；出生帧降序同序逐粒核（rate=帧率 → k=0）
  const seedBaseF = seedOf('part|dyn_t1');
  const expRots: number[] = [];
  for (let b = 50; b >= 0; b--) {
    const age = (50 - b) / 60;
    if (age >= 1.2) continue;
    const sgn = hash01(seedBaseF, b, 0, 71) < 0.5 ? -1 : 1;
    expRots.push(120 * age * sgn + hash01(seedBaseF, b, 0, 72) * 360);
  }
  check('F2 rot = spin×龄×哈希符号 + 哈希初相（产品式）',
    got.length === expRots.length
    && got.every((p, i) => near(p.rot, expRots[i]!, 1e-9)));
}

// ---------- G) 确定性与存活上限（全开配置） ----------
{
  const params = baseParams({
    life: 1.5, speed: 60, directionDeg: 90, spreadDeg: 40, turbulence: 2, buoy: -500,
    maxParticles: 25,
    groundEnabled: true, groundYPx: 8, bounce: 0.5, restVelPx: 40,
    chainEnabled: true, chainLife: 0.4, chainSizeMul: 1.5, chainColor: '#33ccff',
    landEmitEnabled: true, landEmitRate: 120, landEmitDuration: 0.3,
    landEmitColor: '#ffee55', landEmitRise: 80, particleSpinDeg: 90,
  });
  const s1 = sim(params, 90);
  const s2 = sim(params, 90);
  check('G1 全开配置确定性', JSON.stringify(s1) === JSON.stringify(s2) && s1.length > 0);
  check('G2 总存活（含派生）不超上限', s1.length <= 25);
}

console.log(`verify-package-particle-trajectory: ${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
