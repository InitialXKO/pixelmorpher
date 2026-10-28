// ============================================================
// D6 乙路步骤 1：逐帧段长步进器对拍探针（开工门）
// 证：步进器（spike 同数学、探针内实现）在「段长逐帧变化」的
// 驱动下与产品批量 solveVerletChain 逐位一致；快照隔离、
// scrub 重演一致、长程稳定。外加批量求解黄金哈希，锁死
// 后续产品化重构不许改变批量求解的既有结果。
// 跑法：bun scripts/verify-sim-stepper.mts
// ============================================================
import {
  solveVerletChain, defaultChainBakeParams, type ChainBakeParams,
} from '../src/lib/sim/verlet-chain';

let fails = 0;
let total = 0;
const ok = (c: boolean, m: string) => { total++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

// ---------------- 探针内步进器（spike 形态，单步函数） ----------------
interface RtPt { x: number; y: number; px: number; py: number }
interface RtState { pts: RtPt[] }
const createRt = (init: { x: number; y: number }[]): RtState =>
  ({ pts: init.map((q) => ({ x: q.x, y: q.y, px: q.x, py: q.y })) });
const cloneRt = (s: RtState): RtState => ({ pts: s.pts.map((p) => ({ ...p })) });
const serRt = (s: RtState): string => s.pts.map((p) => `${p.x},${p.y},${p.px},${p.py}`).join(';');

function stepRt(
  state: RtState, pin: { x: number; y: number }, lengths: number[],
  params: ChainBakeParams, frameRate: number,
): void {
  const pts = state.pts;
  const n = pts.length;
  const dt = 1 / Math.max(1, frameRate);
  const keep = 1 - Math.max(0, Math.min(0.2, params.damping));
  const iters = Math.max(1, Math.min(24, Math.round(params.iterations)));
  pts[0].x = pin.x; pts[0].y = pin.y; pts[0].px = pin.x; pts[0].py = pin.y;
  for (let i = 1; i < n; i++) {
    const p = pts[i];
    const vx = (p.x - p.px) * keep;
    const vy = (p.y - p.py) * keep;
    p.px = p.x; p.py = p.y;
    p.x += vx + params.windX * dt * dt;
    p.y += vy + params.gravity * dt * dt;
  }
  for (let it = 0; it < iters; it++) {
    pts[0].x = pin.x; pts[0].y = pin.y;
    for (let i = 0; i + 1 < n; i++) {
      const a = pts[i], b = pts[i + 1];
      const want = lengths[i];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-6) { dx = 0; dy = 1; d = 1; }
      const diff = (d - want) / d;
      if (i === 0) {
        b.x -= dx * diff; b.y -= dy * diff;
      } else {
        a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
        b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
      }
    }
  }
}

/** 步进到第 f 帧（帧 1..f 依次步进，输入取各目标帧的 pin/lengths） */
function runTo(
  state: RtState, from: number, to: number,
  pins: { x: number; y: number }[], lens: number[][],
  params: ChainBakeParams, fps: number,
): void {
  for (let f = from + 1; f <= to; f++) stepRt(state, pins[f], lens[f], params, fps);
}

// ---------------- 夹具 ----------------
const FPS = 60;
const BASE = [14, 12, 12, 10, 10, 9, 9];
const pinAt = (f: number) => ({
  x: 200 + 55 * Math.sin(f * 0.045),
  y: 90 + 22 * Math.sin(f * 0.11 + 1.3),
});
const params = defaultChainBakeParams();
const initFrom = (lens0: number[]) => {
  const pts = [pinAt(0)];
  let x = pts[0].x, y = pts[0].y;
  for (const L of lens0) { y += L; pts.push({ x, y }); }
  return pts;
};
const hashRows = (rows: { x: number; y: number }[][]) => {
  let h = 2166136261;
  const s = rows.map((r) => r.map((p) => `${p.x},${p.y}`).join(';')).join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
};

// 夹具 A：常长（spike 同款）
const NA = 150;
const pinsA = Array.from({ length: NA + 1 }, (_, f) => pinAt(f));
const lensA = Array.from({ length: NA + 1 }, () => [...BASE]);
const initA = initFrom(BASE);

// 夹具 B：逐帧变长——正弦调制（模拟链节点拉伸轨道）+ 第 120 帧起前三段阶跃拉伸 1.35×（模拟突变的关键帧）
const lenB = (f: number, i: number) =>
  BASE[i] * (1 + 0.18 * Math.sin(f * 0.07 + i * 1.7)) * (f >= 120 && i < 3 ? 1.35 : 1);
const NB = 200;
const pinsB = Array.from({ length: NB + 1 }, (_, f) => pinAt(f));
const lensB = Array.from({ length: NB + 1 }, (_, f) => BASE.map((_, i) => lenB(f, i)));
const initB = initFrom(lensB[0]);

// ---------------- 0. 批量求解黄金哈希（锁既有行为） ----------------
{
  const batchA = solveVerletChain(pinsA, lensA, initA, params, FPS);
  ok(hashRows(batchA) === 'bac30bcf', '⓪ 批量求解夹具 A 黄金哈希不变（bac30bcf）');
  const batchB = solveVerletChain(pinsB, lensB, initB, params, FPS);
  ok(hashRows(batchB) === '791627ef', '⓪ 批量求解夹具 B（变长）黄金哈希不变（791627ef）');
}

// ---------------- 1. 常长对拍（回归 spike 结论） ----------------
{
  const batch = solveVerletChain(pinsA, lensA, initA, params, FPS);
  const st = createRt(initA);
  let allSame = true;
  for (let f = 0; f <= NA; f++) {
    if (f > 0) stepRt(st, pinsA[f], lensA[f], params, FPS);
    const same = st.pts.every((p, i) => p.x === batch[f][i].x && p.y === batch[f][i].y);
    if (!same) allSame = false;
  }
  ok(allSame, `① 常长：步进器逐帧（0–${NA}）与批量结果逐位一致`);
}

// ---------------- 2. 逐帧变长对拍（本探针主命题） ----------------
{
  const batch = solveVerletChain(pinsB, lensB, initB, params, FPS);
  const st = createRt(initB);
  let allSame = true;
  let midSame = false;
  for (let f = 0; f <= NB; f++) {
    if (f > 0) stepRt(st, pinsB[f], lensB[f], params, FPS);
    const same = st.pts.every((p, i) => p.x === batch[f][i].x && p.y === batch[f][i].y);
    if (!same) allSame = false;
    if (f === 119) midSame = same; // 阶跃前一帧
  }
  ok(midSame, '② 变长：阶跃拉伸前（第 119 帧）逐位一致');
  ok(allSame, `② 逐帧变长（含 120 帧阶跃拉伸）：步进器逐帧（0–${NB}）与批量结果逐位一致`);
}

// ---------------- 3. 确定性（同输入两轮） ----------------
{
  const a = createRt(initB); const b = createRt(initB);
  runTo(a, 0, NB, pinsB, lensB, params, FPS);
  runTo(b, 0, NB, pinsB, lensB, params, FPS);
  ok(serRt(a) === serRt(b), '③ 同输入两轮独立步进 200 帧（含变长），状态逐位一致');
}

// ---------------- 4. 快照隔离 + scrub 重演 ----------------
{
  const live = createRt(initB);
  runTo(live, 0, 50, pinsB, lensB, params, FPS);
  const snap = cloneRt(live);
  const snapSer = serRt(snap);
  runTo(live, 50, 200, pinsB, lensB, params, FPS);
  const contState = serRt(live);
  ok(serRt(snap) === snapSer, '④ 活状态继续步进 150 帧后，第 50 帧快照逐位未变');
  const replay = cloneRt(snap);
  runTo(replay, 50, 137, pinsB, lensB, params, FPS);
  const direct = createRt(initB);
  runTo(direct, 0, 137, pinsB, lensB, params, FPS);
  ok(serRt(replay) === serRt(direct), '④ 从第 50 帧快照重演到 137 == 从零连续步进到 137（逐位，含速度分量）');
  const replay2 = cloneRt(snap);
  runTo(replay2, 50, 200, pinsB, lensB, params, FPS);
  ok(serRt(replay2) === contState, '④ 从快照重演到 200 == 原活状态连续步进到 200（逐位）');
}

// ---------------- 5. 长程稳定（变长驱动） ----------------
{
  const F = 3600;
  const pins = Array.from({ length: F + 1 }, (_, f) => pinAt(f));
  // 长程夹具只用平滑变长（正弦调制）：阶跃突变已由 ② 的对拍覆盖，
  // 这里量的是持续变长下的残差量级，不叠加每 240 帧一次的人为跳变。
  const lenS = (f: number, i: number) => BASE[i] * (1 + 0.18 * Math.sin(f * 0.07 + i * 1.7));
  const lens = Array.from({ length: F + 1 }, (_, f) => BASE.map((_, i) => lenS(f, i)));
  const st = createRt(initFrom(lens[0]));
  let allFinite = true;
  let earlyErr = 0; let lateErr = 0; let maxErr = 0;
  let tipTravel = 0; let prevTip = { ...st.pts[st.pts.length - 1] };
  for (let f = 1; f <= F; f++) {
    stepRt(st, pins[f], lens[f], params, FPS);
    for (let i = 0; i < st.pts.length; i++) {
      const p = st.pts[i];
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) allFinite = false;
      if (i + 1 < st.pts.length) {
        const d = Math.hypot(st.pts[i + 1].x - p.x, st.pts[i + 1].y - p.y);
        const e = Math.abs(d - lens[f][i]) / lens[f][i];
        maxErr = Math.max(maxErr, e);
        if (f <= 600) earlyErr = Math.max(earlyErr, e);
        if (f > F - 600) lateErr = Math.max(lateErr, e);
      }
    }
    const tip = st.pts[st.pts.length - 1];
    tipTravel += Math.hypot(tip.x - prevTip.x, tip.y - prevTip.y);
    prevTip = { x: tip.x, y: tip.y };
  }
  console.log(`    [⑤] 变长驱动 3600 帧：最大段长相对误差（对当帧目标长）${(maxErr * 100).toFixed(2)}%（前窗 ${(earlyErr * 100).toFixed(2)}% / 后窗 ${(lateErr * 100).toFixed(2)}%），链尾行程 ${tipTravel.toFixed(0)}px`);
  ok(allFinite, '⑤ 变长驱动 3600 帧全程坐标有限');
  ok(maxErr < 0.10, '⑤ 段长误差（对当帧目标长）有界 <10%');
  ok(lateErr <= earlyErr * 1.5 + 0.005, '⑤ 误差无随时间增长');
  ok(tipTravel > 1000, '⑤ 链尾确实在动（非静止假过）');
}

console.log(fails === 0 ? `\n全部 ${total} 条断言通过` : `\n${fails}/${total} 条断言失败`);
process.exit(fails === 0 ? 0 : 1);
