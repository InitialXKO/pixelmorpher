// D6 实时模拟 spike：最小「有状态增量 Verlet 链步进器」+ 片段起点
// 快照会话层（形态照 PR #55 的 clamp-session：状态只从片段起点
// 快照初始化、逐帧步进、跳帧 = 取快照顺演）。要证的不是求解器
// 本身（一期烘焙的 solveVerletChain 已是产品代码），而是：
//   ① 同一快照两轮独立步进 → 逐位一致（确定性）
//   ② 快照顺演到第 N 帧 == 连续步进到第 N 帧（scrub 一致性）
//   ③ 步进中改活状态不污染已存快照（快照隔离/深拷贝纪律）
//   ④ 长程步进链长误差有界、数值不发散（稳定性）
//   ⑤ 实时步进器与产品烘焙求解器 solveVerletChain 逐位一致
//     （实时路线不需要第三份求解器，数学可直接复用）
//   ⑥ 单链每帧步进耗时（粗测，给运行时预算一个量级）
// 跑法：bun spikes/d6-runtime-sim/spike.mts
import {
  solveVerletChain, defaultChainBakeParams, type ChainBakeParams,
} from '../../src/lib/sim/verlet-chain';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

// ---------------- 实时步进器（spike 本体） ----------------
// 与 solveVerletChain 同一数学（积分→距离约束迭代→钉点复位），
// 差别只在形态：批量纯函数 → 状态对象 + 单步函数。状态 = 每质点
// 的 (x, y, px, py)，快照 = 深拷贝这组数，别无其他隐藏状态。

interface RtPt { x: number; y: number; px: number; py: number }
interface RtChainState { pts: RtPt[] }

function createRtState(init: { x: number; y: number }[]): RtChainState {
  return { pts: init.map((q) => ({ x: q.x, y: q.y, px: q.x, py: q.y })) };
}
function cloneRtState(s: RtChainState): RtChainState {
  return { pts: s.pts.map((p) => ({ ...p })) };
}
function serializeRtState(s: RtChainState): string {
  return s.pts.map((p) => `${p.x},${p.y},${p.px},${p.py}`).join(';');
}

/** 步进一帧：pin = 本帧链根世界位（驱动点），lengths = 各段约束长。 */
function stepRtChain(
  state: RtChainState, pin: { x: number; y: number }, lengths: number[],
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

// ---------------- 驱动与夹具 ----------------
// 驱动点 = 确定性闭式轨迹（模拟「作者动画给出的链根逐帧世界位」）：
// 圆周+竖直摆动混合，幅度足以让链明显甩动。
const FPS = 60;
const LENGTHS = [14, 12, 12, 10, 10, 9, 9]; // 7 段 8 点
const pinAt = (f: number) => ({
  x: 200 + 55 * Math.sin(f * 0.045),
  y: 90 + 22 * Math.sin(f * 0.11 + 1.3),
});
const initJoints = (() => {
  const pts = [pinAt(0)];
  let x = pts[0].x, y = pts[0].y;
  for (const L of LENGTHS) { y += L; pts.push({ x, y }); }
  return pts;
})();
const params = defaultChainBakeParams();

// 会话层（仿 clamp-session 的最小形态）：片段起点快照只在「片段
// 开始」时建立；状态从快照克隆出来步进，快照本体永不被步进污染。
class SimSession {
  private snapshot: RtChainState;
  private live: RtChainState;
  private liveFrame: number; // live 状态已步进到的帧
  readonly clipStart: number;
  constructor(clipStart: number, init: { x: number; y: number }[]) {
    this.clipStart = clipStart;
    this.snapshot = createRtState(init);
    this.live = cloneRtState(this.snapshot);
    this.liveFrame = clipStart;
  }
  /** 取第 f 帧的链关节位：连续则接步，跳帧则从快照重演。 */
  jointsAt(f: number): { x: number; y: number }[] {
    if (f < this.liveFrame) {
      this.live = cloneRtState(this.snapshot);
      this.liveFrame = this.clipStart;
    }
    while (this.liveFrame < f) {
      const nf = this.liveFrame + 1;
      stepRtChain(this.live, pinAt(nf), LENGTHS, params, FPS);
      this.liveFrame = nf;
    }
    return this.live.pts.map((p) => ({ x: p.x, y: p.y }));
  }
  liveState(): RtChainState { return this.live; }
  snapshotState(): RtChainState { return this.snapshot; }
}

// ---------------- ① 确定性 ----------------
{
  const a = new SimSession(0, initJoints);
  const b = new SimSession(0, initJoints);
  const ja = a.jointsAt(120);
  const jb = b.jointsAt(120);
  ok(serializeRtState(a.liveState()) === serializeRtState(b.liveState()),
    '① 同快照两轮独立步进 120 帧，状态逐位一致');
  ok(ja.every((p, i) => p.x === jb[i].x && p.y === jb[i].y), '① 关节位逐位一致');
}

// ---------------- ② scrub 一致性 ----------------
{
  const s = new SimSession(0, initJoints);
  const continuous = s.jointsAt(120).map((p) => `${p.x},${p.y}`).join(';');
  const contState = serializeRtState(s.liveState());
  s.jointsAt(200); // 活状态先推进到更远处（模拟播过头）
  const scrubbed = s.jointsAt(120).map((p) => `${p.x},${p.y}`).join(';'); // 跳回 → 必须从快照重演
  ok(scrubbed === continuous, '② 跳回第 120 帧 == 连续步进到第 120 帧（逐位）');
  ok(serializeRtState(s.liveState()) === contState, '② 重演后完整状态（含速度）逐位一致');
  // 另一条会话从零独立重演到 120，结果应与第一条会话的连续步进相同
  const s2 = new SimSession(0, initJoints);
  s2.jointsAt(120);
  ok(serializeRtState(s2.liveState()) === contState,
    '② 独立会话从快照重演到 120 == 第一会话连续步进（逐位）');
}

// ---------------- ③ 快照隔离 ----------------
{
  const s = new SimSession(0, initJoints);
  const snapBefore = serializeRtState(s.snapshotState());
  s.jointsAt(90);
  ok(serializeRtState(s.snapshotState()) === snapBefore,
    '③ 活状态步进 90 帧后，片段起点快照逐位未变（深拷贝纪律成立）');
}

// ---------------- ④ 稳定性（长程有界） ----------------
{
  const s = new SimSession(0, initJoints);
  const FRAMES = 3600; // 60 秒 @60fps
  let maxRelErr = 0;
  let earlyErr = 0; // 前 600 帧窗口的最大误差
  let lateErr = 0;  // 后 600 帧窗口的最大误差（与前窗比对看有无 secular 增长）
  let allFinite = true;
  let maxAbs = 0;
  let tipTravel = 0;
  let prevTip = initJoints[initJoints.length - 1];
  for (let f = 1; f <= FRAMES; f++) {
    const js = s.jointsAt(f);
    for (let i = 0; i < js.length; i++) {
      if (!Number.isFinite(js[i].x) || !Number.isFinite(js[i].y)) allFinite = false;
      maxAbs = Math.max(maxAbs, Math.abs(js[i].x), Math.abs(js[i].y));
      if (i + 1 < js.length) {
        const d = Math.hypot(js[i + 1].x - js[i].x, js[i + 1].y - js[i].y);
        const e = Math.abs(d - LENGTHS[i]) / LENGTHS[i];
        maxRelErr = Math.max(maxRelErr, e);
        if (f <= 600) earlyErr = Math.max(earlyErr, e);
        if (f > FRAMES - 600) lateErr = Math.max(lateErr, e);
      }
    }
    const tip = js[js.length - 1];
    tipTravel += Math.hypot(tip.x - prevTip.x, tip.y - prevTip.y);
    prevTip = tip;
  }
  console.log(`    [④] 3600 帧：最大段长相对误差 ${(maxRelErr * 100).toFixed(2)}%（前窗 ${(earlyErr * 100).toFixed(2)}% / 后窗 ${(lateErr * 100).toFixed(2)}%），最大坐标 ${maxAbs.toFixed(1)}，链尾累计行程 ${tipTravel.toFixed(0)}px`);
  // 注：本夹具是压力档——自由质点终端速度 ≈ g·dt²/(1−damping) ≈ 13.6px/帧，
  // 与段长（9–14px）同量级；约束残差在此工况下实测约 6.6% 峰值，属「有界」
  // 而非「高精度」。断言取稳定性口径：有限、有界、误差不随时间增长。
  ok(allFinite, '④ 3600 帧全程坐标有限（不发散）');
  ok(maxRelErr < 0.10, `④ 段长相对误差有界 <10%（压力工况实测 ${(maxRelErr * 100).toFixed(2)}%）`);
  ok(lateErr <= earlyErr * 1.5 + 0.005, `④ 误差无 secular 增长（后窗 ${(lateErr * 100).toFixed(2)}% vs 前窗 ${(earlyErr * 100).toFixed(2)}%）`);
  ok(maxAbs < 10000, '④ 坐标幅值有界');
  ok(tipTravel > 1000, '④ 链尾确实在动（行程 >1000px，非静止假过）');
}

// ---------------- ⑤ 与产品烘焙求解器逐位对拍 ----------------
{
  const N = 150;
  const pins = Array.from({ length: N + 1 }, (_, f) => pinAt(f));
  const lens = Array.from({ length: N + 1 }, () => [...LENGTHS]);
  const batch = solveVerletChain(pins, lens, initJoints, params, FPS);
  const s = new SimSession(0, initJoints);
  const rt = s.jointsAt(N);
  const same = rt.every((p, i) => p.x === batch[N][i].x && p.y === batch[N][i].y);
  ok(same, `⑤ 实时步进 ${N} 帧与 solveVerletChain 批量结果逐位一致（同一数学、两种形态）`);
}

// ---------------- ⑥ 耗时粗测 ----------------
{
  const state = createRtState(initJoints);
  const STEPS = 20000;
  const t0 = performance.now();
  for (let f = 1; f <= STEPS; f++) stepRtChain(state, pinAt(f), LENGTHS, params, FPS);
  const ms = performance.now() - t0;
  const us = (ms * 1000) / STEPS;
  console.log(`    [⑥] 单链（8 点/7 段、迭代 ${params.iterations}）步进 ${STEPS} 帧共 ${ms.toFixed(1)}ms → ${us.toFixed(2)}µs/帧；20 条链 ≈ ${(us * 20).toFixed(1)}µs/帧`);
  ok(us < 50, `⑥ 单链步进 <50µs/帧（实测 ${us.toFixed(2)}µs）`);
}

console.log(fails === 0 ? '\n全部断言通过' : `\n${fails} 条断言失败`);
process.exit(fails === 0 ? 0 : 1);
