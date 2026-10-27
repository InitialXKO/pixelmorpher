/**
 * IK (Inverse Kinematics) solvers for blueprint.
 *
 * Two solvers:
 * - solveIK2Bone: Analytic 2-bone IK (exact, O(1))
 * - solveIKFabrik: FABRIK iterative solver for N-bone chains
 *
 * Coordinate system: degrees for angles, pixels for positions.
 * Angles are measured from positive X axis, counterclockwise positive
 * (matching the existing NodeTransform.angle convention).
 */

export interface IK2BoneInput {
  /** Target position in the parent (shoulder) space */
  targetX: number;
  targetY: number;
  /** Bone lengths */
  len1: number;
  len2: number;
  /** Base (shoulder) position, default (0, 0) */
  baseX?: number;
  baseY?: number;
  /** Bend direction: +1 = elbow bends counterclockwise, -1 = clockwise. Default +1. */
  bendDir?: number;
}

export interface IK2BoneOutput {
  /** Shoulder joint angle (degrees, absolute in parent space) */
  angle1: number;
  /** Elbow joint angle (degrees, relative to bone1) */
  angle2: number;
  /** Whether the target was reachable */
  reachable: boolean;
}

/**
 * Analytic 2-bone IK solver.
 *
 * Given a target (tx, ty) and two bone lengths (l1, l2),
 * computes the joint angles using the law of cosines.
 *
 * If target is out of reach (|target| > l1 + l2), the arm
 * fully extends toward the target (reachable = false).
 * If target is too close (|target| < |l1 - l2|), the arm
 * folds as much as possible.
 */
export function solveIK2Bone(input: IK2BoneInput): IK2BoneOutput {
  const {
    targetX,
    targetY,
    len1,
    len2,
    baseX = 0,
    baseY = 0,
    bendDir = 1,
  } = input;

  // Target relative to base
  const dx = targetX - baseX;
  const dy = targetY - baseY;
  let dist = Math.hypot(dx, dy);

  const maxReach = len1 + len2;
  const minReach = Math.abs(len1 - len2);

  let reachable = true;
  let tx = dx;
  let ty = dy;

  // Clamp to reachable annulus
  if (dist > maxReach) {
    reachable = false;
    const s = maxReach / dist;
    tx = dx * s;
    ty = dy * s;
    dist = maxReach;
  } else if (dist < minReach) {
    reachable = false;
    if (dist < 1e-6) {
      // Target at base: fold along +X
      tx = minReach;
      ty = 0;
    } else {
      const s = minReach / dist;
      tx = dx * s;
      ty = dy * s;
    }
    dist = minReach;
  }

  // Angle to target
  const targetAngle = Math.atan2(ty, tx);

  // Law of cosines: angle at shoulder between target direction and bone1
  // cos(A) = (l1² + d² - l2²) / (2 * l1 * d)
  // Guard: 0-length bones or 0 dist → NaN，返回 0 角度
  let angleA = 0;
  if (len1 > 1e-6 && dist > 1e-6) {
    const cosA = (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist);
    angleA = Math.acos(Math.max(-1, Math.min(1, cosA)));
  }

  // Shoulder angle (absolute)
  // bendDir=+1: elbow bends counterclockwise from target direction
  // bendDir=-1: elbow bends clockwise from target direction
  const shoulderRad = targetAngle - bendDir * angleA;
  const angle1 = (shoulderRad * 180) / Math.PI;

  // Law of cosines: interior elbow angle
  // cos(B) = (l1² + l2² - d²) / (2 * l1 * l2)
  // Guard: 0-length bones → NaN
  let interiorAngle = Math.PI;
  if (len1 > 1e-6 && len2 > 1e-6) {
    const cosB = (len1 * len1 + len2 * len2 - dist * dist) / (2 * len1 * len2);
    interiorAngle = Math.acos(Math.max(-1, Math.min(1, cosB)));
  }

  // Elbow angle relative to bone1 (0 = straight)
  // Sign is opposite of shoulder offset to maintain the bend direction.
  const elbowRad = bendDir * (Math.PI - interiorAngle);
  const angle2 = (elbowRad * 180) / Math.PI;

  return { angle1, angle2, reachable };
}

export interface FabrikJoint {
  x: number;
  y: number;
}

export interface IKFabrikInput {
  /** Target position */
  targetX: number;
  targetY: number;
  /** Bone lengths (n bones = n+1 joints) */
  lengths: number[];
  /** Base (root) position, fixed */
  baseX?: number;
  baseY?: number;
  /** Max iterations, default 10 */
  iterations?: number;
  /** Convergence tolerance in pixels, default 0.5 */
  tolerance?: number;
}

export interface IKFabrikOutput {
  /** Joint positions (n+1 points, first is base) */
  joints: FabrikJoint[];
  /** Joint angles in degrees (n angles, absolute in parent space) */
  angles: number[];
  /** Whether converged within tolerance */
  converged: boolean;
}

/**
 * FABRIK (Forward And Backward Reaching Inverse Kinematics) solver.
 *
 * Iteratively adjusts joint positions:
 * 1. Backward: from end effector to base, pulling joints toward target
 * 2. Forward: from base to end effector, pushing joints out from base
 *
 * Converges quickly for most cases. Handles unreachable targets
 * by extending fully toward the target.
 */
export function solveIKFabrik(input: IKFabrikInput): IKFabrikOutput {
  const {
    targetX,
    targetY,
    lengths,
    baseX = 0,
    baseY = 0,
    iterations = 10,
    tolerance = 0.5,
  } = input;

  const n = lengths.length;
  if (n === 0) {
    return { joints: [{ x: baseX, y: baseY }], angles: [], converged: true };
  }

  // Initialize joints in a straight line along +X
  const joints: FabrikJoint[] = [{ x: baseX, y: baseY }];
  let cx = baseX;
  for (let i = 0; i < n; i++) {
    cx += lengths[i];
    joints.push({ x: cx, y: baseY });
  }

  const totalLen = lengths.reduce((a, b) => a + b, 0);
  const distToTarget = Math.hypot(targetX - baseX, targetY - baseY);

  // Unreachable: extend fully toward target
  if (distToTarget > totalLen) {
    const dirX = (targetX - baseX) / distToTarget;
    const dirY = (targetY - baseY) / distToTarget;
    let px = baseX;
    let py = baseY;
    for (let i = 0; i < n; i++) {
      px += dirX * lengths[i];
      py += dirY * lengths[i];
      joints[i + 1] = { x: px, y: py };
    }
    return { joints, angles: jointsToAngles(joints), converged: false };
  }

  // Reachable: iterate FABRIK
  let converged = false;
  for (let iter = 0; iter < iterations; iter++) {
    // Backward reaching: set end effector to target, work back to base
    joints[n] = { x: targetX, y: targetY };
    for (let i = n - 1; i >= 0; i--) {
      const next = joints[i + 1];
      const curr = joints[i];
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const s = lengths[i] / d;
      joints[i] = {
        x: next.x - dx * s,
        y: next.y - dy * s,
      };
    }

    // Forward reaching: reset base, work forward to end
    joints[0] = { x: baseX, y: baseY };
    for (let i = 0; i < n; i++) {
      const curr = joints[i];
      const next = joints[i + 1];
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const s = lengths[i] / d;
      joints[i + 1] = {
        x: curr.x + dx * s,
        y: curr.y + dy * s,
      };
    }

    // Check convergence
    const endDist = Math.hypot(joints[n].x - targetX, joints[n].y - targetY);
    if (endDist < tolerance) {
      converged = true;
      break;
    }
  }

  return { joints, angles: jointsToAngles(joints), converged };
}

/** Convert joint positions to absolute angles (degrees). */
function jointsToAngles(joints: FabrikJoint[]): number[] {
  const angles: number[] = [];
  for (let i = 0; i < joints.length - 1; i++) {
    const dx = joints[i + 1].x - joints[i].x;
    const dy = joints[i + 1].y - joints[i].y;
    angles.push((Math.atan2(dy, dx) * 180) / Math.PI);
  }
  return angles;
}

// ============================================================
// 真 3D 位置求解（乙）：与 frame FK 自洽——先解关节世界位置，
// 再由 unified-render 的 solveLocalAngleTilt 闭式反解每关节 (angle, tilt)。
// ============================================================

export interface IK3DPoint { x: number; y: number; z: number }

const v3 = (a: IK3DPoint, b: IK3DPoint): IK3DPoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add3 = (a: IK3DPoint, b: IK3DPoint): IK3DPoint => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul3 = (a: IK3DPoint, s: number): IK3DPoint => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const len3 = (a: IK3DPoint): number => Math.hypot(a.x, a.y, a.z);
const norm3 = (a: IK3DPoint): IK3DPoint => { const l = len3(a); return l < 1e-12 ? { x: 0, y: 0, z: 0 } : mul3(a, 1 / l); };
const dot3 = (a: IK3DPoint, b: IK3DPoint): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * 3D 两骨 IK（解析）：在 (root, target, pole) 定义的平面内解。
 * pole 决定肘的弯曲侧；目标超距时全伸直指向目标，目标过近时按余弦定理钳制。
 * 返回 mid（肘）与 end（末端，钳制后）位置。
 */
export function solveIK2Bone3D(
  root: IK3DPoint,
  target: IK3DPoint,
  len1: number,
  len2: number,
  pole: IK3DPoint,
): { mid: IK3DPoint; end: IK3DPoint } {
  const toT = v3(target, root);
  const total = len1 + len2;
  let dist = len3(toT);
  const minDist = Math.abs(len1 - len2) + 1e-6;
  dist = Math.max(minDist, Math.min(total - 1e-6, dist));
  const dir = norm3(toT);
  const end = add3(root, mul3(dir, dist));
  // 余弦定理：root→mid 在 dir 上的投影长 a，高 h
  const a = (len1 * len1 - len2 * len2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, len1 * len1 - a * a));
  // 弯曲方向：pole 相对 root→target 轴的正交分量；退化时任取正交方向
  let perp = v3(pole, root);
  perp = v3(perp, mul3(dir, dot3(perp, dir)));
  if (len3(perp) < 1e-9) {
    // pole 与轴共线：用与 dir 不平行的任意轴叉积
    const ax = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    perp = {
      x: dir.y * ax.z - dir.z * ax.y,
      y: dir.z * ax.x - dir.x * ax.z,
      z: dir.x * ax.y - dir.y * ax.x,
    };
  }
  perp = norm3(perp);
  const mid = add3(add3(root, mul3(dir, a)), mul3(perp, h));
  return { mid, end };
}

/** 两向量夹角（偏离直线的弯角，0 = 共线同向） */
function bendAngle3(a: IK3DPoint, b: IK3DPoint): number {
  const la = len3(a), lb = len3(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  const c = Math.max(-1, Math.min(1, dot3(a, b) / (la * lb)));
  return Math.acos(c);
}

/**
 * 3D 三骨 IK（解析）：三段长 len1/len2/len3、两个中间关节，末端到 target。
 *
 * 三段对末端目标多一个自由度，用弯曲分配定解：中间两关节的弯角按
 * β1 : β2 = len2 : len3 分担（远段越长分得越少；腕/尖端侧天然少弯）。
 * 以有符号弯角 β1 为参数（符号由 pole 定侧）：A = |p2 − root| 随 β1
 * 定，p2 取「到 root 距 A、到 target 距 len3」两球交圆在弯平面内靠
 * pole 侧的点，p1 再由 2 骨解析定——两弯同号同平面（不会像按 A 扫
 * 那样落进反向弯的 S 形构型）。分配比对 β1 单调，二分命中；β2 变号
 * 处是同号族的边界，搜索范围钳到那里为止。退化构型返回 null，
 * 调用方回落 FABRIK。
 *
 * seed（可选，当前关节位）：一参族内取 β1 最贴当前姿态的解——解析
 * 解成为当前姿态的连续延拓，目标恰为当前末端时逐点复现当前姿态
 * （启用链不跳、逐帧不抖）；不给 seed 时按弯曲分配定解。
 */
export function solveIK3Bone3D(
  root: IK3DPoint,
  target: IK3DPoint,
  len1: number,
  len2: number,
  len3_: number,
  pole: IK3DPoint,
  seed?: { p1: IK3DPoint; p2: IK3DPoint; p3: IK3DPoint },
): { p1: IK3DPoint; p2: IK3DPoint; end: IK3DPoint } | null {
  const toT = v3(target, root);
  const dist = len3(toT);
  const total = len1 + len2 + len3_;
  if (dist < 1e-9 || len1 <= 0 || len2 <= 0 || len3_ < 0) return null;
  const dir = mul3(toT, 1 / dist);
  if (dist >= total - 1e-9) {
    // 不可达：全伸直指向目标
    const p1 = add3(root, mul3(dir, len1));
    const p2 = add3(p1, mul3(dir, len2));
    const end = add3(p2, mul3(dir, len3_));
    return { p1, p2, end };
  }
  // 最小可达距离（最长段与其余之差）；目标过近无解析构型 → 回落
  const longest = Math.max(len1, len2, len3_);
  if (dist < longest - (total - longest) - 1e-9) return null;

  // 弯平面：dir 与 pole 的垂向分量定 perpU；共线时取视平面内回退
  // （dir × ẑ，再退化才 dir × ŷ），法向 n = dir × perpU 定弯角符号。
  const rel = v3(pole, root);
  const axial = dot3(rel, dir);
  let perp = add3(rel, mul3(dir, -axial));
  if (len3(perp) < 1e-6 * Math.max(1, dist)) {
    perp = { x: dir.y, y: -dir.x, z: 0 };
    if (len3(perp) < 1e-6) perp = { x: dir.z, y: 0, z: -dir.x };
  }
  const perpU = norm3(perp);
  const nrm = norm3({
    x: dir.y * perpU.z - dir.z * perpU.y,
    y: dir.z * perpU.x - dir.x * perpU.z,
    z: dir.x * perpU.y - dir.y * perpU.x,
  });
  const polePt = add3(root, add3(mul3(dir, axial), mul3(perpU, Math.max(1, dist))));
  const signedAngle = (u: IK3DPoint, v: IK3DPoint): number => {
    const cx = u.y * v.z - u.z * v.y;
    const cy = u.z * v.x - u.x * v.z;
    const cz = u.x * v.y - u.y * v.x;
    return Math.atan2(cx * nrm.x + cy * nrm.y + cz * nrm.z, dot3(u, v));
  };

  // A 窗 → β1 窗（A 随 β1 单调减：A² = L1² + L2² + 2·L1·L2·cosβ1）
  const eps = 1e-6;
  const aLo = Math.max(Math.abs(len1 - len2), dist - len3_) + eps;
  const aHi = Math.min(len1 + len2, dist + len3_) - eps;
  if (aLo > aHi) return null;
  const betaAt = (A: number) => Math.acos(Math.max(-1, Math.min(1,
    (A * A - len1 * len1 - len2 * len2) / (2 * len1 * len2))));
  let bLo = betaAt(aHi); // A 大 → β1 小
  let bHi = betaAt(aLo);
  const configAt = (b1: number) => {
    const A = Math.sqrt(Math.max(0, len1 * len1 + len2 * len2 + 2 * len1 * len2 * Math.cos(b1)));
    const a2 = (A * A - len3_ * len3_ + dist * dist) / (2 * dist);
    const h2 = Math.sqrt(Math.max(0, A * A - a2 * a2));
    // p2 落侧：pole 是第一关节的侧向提示，推不出第二关节的落侧
    // （肘近 root→target 轴时两者可反侧）；有 seed 时跟 seed 的
    // p2 实际落侧，否则默认 pole 侧。
    let side = 1;
    if (seed) {
      const off = v3(seed.p2, add3(root, mul3(dir, a2)));
      if (dot3(off, perpU) < 0) side = -1;
    }
    const p2 = add3(root, add3(mul3(dir, a2), mul3(perpU, h2 * side)));
    const p1 = solveIK2Bone3D(root, p2, len1, len2, polePt).mid;
    const d1 = v3(p1, root);
    const d2 = v3(p2, p1);
    const d3 = v3(target, p2);
    return { p1, p2, end: { ...target }, sB1: signedAngle(d1, d2), sB2: signedAngle(d2, d3) };
  };
  // 姿态种子：族内取与当前弯角对 (β1, β2) 偏差最小的成员——目标恰
  // 为当前末端时当前构型本身是族成员、偏差 0、逐点复现（启用链不
  // 跳）；目标移动时解连续跟随当前姿态，不重排弯曲分配。
  if (seed) {
    // 当前末端已在目标容差内 → 种子本身即解（近全伸直时圆交几何
    // 病态：径向 0.1px 误差会被放大成数 px 切向位移；已达标不重解）
    if (len3(v3(target, seed.p3)) < Math.max(0.25, total * 1e-3)) {
      return { p1: { ...seed.p1 }, p2: { ...seed.p2 }, end: { ...target } };
    }
    const s1 = signedAngle(v3(seed.p1, root), v3(seed.p2, seed.p1));
    const s2 = signedAngle(v3(seed.p2, seed.p1), v3(seed.p3, seed.p2));
    const dev = (c: { sB1: number; sB2: number }) =>
      (c.sB1 - s1) * (c.sB1 - s1) + (c.sB2 - s2) * (c.sB2 - s2);
    const N = 24;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i <= N; i++) {
      const d = dev(configAt(bLo + ((bHi - bLo) * i) / N));
      if (d < bd) { bd = d; bi = i; }
    }
    let lo = bLo + ((bHi - bLo) * Math.max(0, bi - 1)) / N;
    let hi = bLo + ((bHi - bLo) * Math.min(N, bi + 1)) / N;
    const gr = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - gr * (hi - lo);
    let x2 = lo + gr * (hi - lo);
    let f1 = dev(configAt(x1));
    let f2 = dev(configAt(x2));
    for (let i = 0; i < 24; i++) {
      if (f1 <= f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - gr * (hi - lo); f1 = dev(configAt(x1)); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + gr * (hi - lo); f2 = dev(configAt(x2)); }
    }
    return configAt((lo + hi) / 2);
  }
  // 同号族边界：β2 变号处（β2 = 0 是该族的自然终点，分配比在那里 = 1）
  {
    const cHi = configAt(bHi);
    const cLo = configAt(bLo);
    if (cLo.sB2 !== 0 && cHi.sB2 !== 0 && Math.sign(cHi.sB2) !== Math.sign(cLo.sB2)) {
      let lo = bLo, hi = bHi;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const cm = configAt(mid);
        if (Math.sign(cm.sB2) === Math.sign(cLo.sB2)) lo = mid; else hi = mid;
      }
      bHi = lo;
    }
  }
  const targetShare = len3_ <= 1e-9 ? 1 : len2 / (len2 + len3_);
  const shareOf = (c: { sB1: number; sB2: number }) => {
    const d = Math.abs(c.sB1) + Math.abs(c.sB2);
    return d < 1e-9 ? targetShare : Math.abs(c.sB1) / d;
  };
  const cLo = configAt(bLo);
  const cHi = configAt(bHi);
  const fLo = shareOf(cLo) - targetShare;
  const fHi = shareOf(cHi) - targetShare;
  if (Math.abs(fLo) < 1e-7) return cLo;
  if (Math.abs(fHi) < 1e-7) return cHi;
  if (fLo * fHi > 0) return Math.abs(fLo) <= Math.abs(fHi) ? cLo : cHi;
  let best = Math.abs(fLo) <= Math.abs(fHi) ? cLo : cHi;
  let lo = bLo, hi = bHi;
  for (let i = 0; i < 56; i++) {
    const mid = (lo + hi) / 2;
    const c = configAt(mid);
    const f = shareOf(c) - targetShare;
    if (Math.abs(f) < Math.abs(shareOf(best) - targetShare)) best = c;
    if (Math.abs(f) < 1e-7) { best = c; break; }
    if ((f > 0) === (fLo > 0)) lo = mid; else hi = mid;
  }
  return best;
}

/** 把向量 v 按「单位向量 a 转到 b」的摆转旋转（Rodrigues），退化时回退 */
function swingRotate3(a: IK3DPoint, b: IK3DPoint, v: IK3DPoint): IK3DPoint {
  const axis = {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
  const al = len3(axis);
  const d = Math.max(-1, Math.min(1, dot3(a, b)));
  if (al < 1e-9) {
    if (d > 0) return v;
    // 反向：绕任一与 a 正交的轴转 π
    const ax = Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const k = norm3({
      x: a.y * ax.z - a.z * ax.y,
      y: a.z * ax.x - a.x * ax.z,
      z: a.x * ax.y - a.y * ax.x,
    });
    // 绕 k 转 π：v' = 2(k·v)k − v
    return add3(mul3(k, 2 * dot3(k, v)), mul3(v, -1));
  }
  const k = mul3(axis, 1 / al);
  const ang = Math.acos(d);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const term1 = mul3(v, cos);
  const cross = {
    x: k.y * v.z - k.z * v.y,
    y: k.z * v.x - k.x * v.z,
    z: k.x * v.y - k.y * v.x,
  };
  const term2 = mul3(cross, sin);
  const term3 = mul3(k, dot3(k, v) * (1 - cos));
  return add3(add3(term1, term2), term3);
}

/**
 * 四段（3 骨 + 尖端段）：尖端是末关节 frame +Y 的刚性延伸，不占弯曲
 * 自由度。把尖端剥掉——关节目标 = target − 尖端向 × 尖端长，关节链走
 * 三骨解析解；尖端向先取 FK 值、按解后末段向摆转修正再解一次（末关
 * 节朝向相对末段的偏角与 FK 保持一致）。返回 5 点（4 关节 + 尖端）。
 */
export function solveIK3BoneWithTip3D(
  points: IK3DPoint[],
  lengths: number[],
  target: IK3DPoint,
  pole: IK3DPoint,
): IK3DPoint[] | null {
  if (points.length !== 5 || lengths.length !== 4) return null;
  const tipLen = lengths[3];
  const fkTipDir = norm3(v3(points[4], points[3]));
  const fkSegDir = norm3(v3(points[3], points[2]));
  // 迭代：以 u 定关节目标解关节，再按解后末段向摆转更新 u；收敛时
  // (u, joints) 自洽。不收敛时以最后的 u 再解一次，保证返回的关节与
  // 尖端出自同一个 u（尖端 = 末关节 + u × 尖端长，恒精确达标）。
  let u = fkTipDir;
  for (let pass = 0; pass < 4; pass++) {
    const jt = add3(target, mul3(u, -tipLen));
    const r = solveIK3Bone3D(points[0], jt, lengths[0], lengths[1], lengths[2], pole, { p1: points[1], p2: points[2], p3: points[3] });
    if (!r) return null;
    const joints = [points[0], r.p1, r.p2, r.end];
    const segDir = norm3(v3(r.end, r.p2));
    const u2 = norm3(swingRotate3(fkSegDir, segDir, fkTipDir));
    if (bendAngle3(u, u2) < 1e-4) {
      return [...joints, add3(joints[3], mul3(u2, tipLen))];
    }
    u = u2;
  }
  const jtF = add3(target, mul3(u, -tipLen));
  const rF = solveIK3Bone3D(points[0], jtF, lengths[0], lengths[1], lengths[2], pole, { p1: points[1], p2: points[2], p3: points[3] });
  if (!rF) return null;
  const jointsF = [points[0], rF.p1, rF.p2, rF.end];
  return [...jointsF, add3(jointsF[3], mul3(u, tipLen))];
}

/**
 * 3D FABRIK：根固定，迭代前后向使末端到达 target（不可达时全伸直指向）。
 * points 为初始关节位置（取 FK），lengths 为段长（points.length - 1 段）。
 */
export function solveIKFabrik3D(
  points: IK3DPoint[],
  lengths: number[],
  target: IK3DPoint,
  iterations = 40,
): IK3DPoint[] {
  const n = points.length;
  const pts = points.map((p) => ({ ...p }));
  const root = { ...points[0] };
  const totalLen = lengths.reduce((s, l) => s + l, 0);
  if (len3(v3(target, root)) >= totalLen) {
    // 不可达：沿目标方向全伸直
    const dir = norm3(v3(target, root));
    for (let i = 1; i < n; i++) pts[i] = add3(pts[i - 1], mul3(dir, lengths[i - 1]));
    return pts;
  }
  for (let it = 0; it < iterations; it++) {
    // 后向：末端 → target
    pts[n - 1] = { ...target };
    for (let i = n - 2; i >= 0; i--) {
      const dir = norm3(v3(pts[i], pts[i + 1]));
      pts[i] = add3(pts[i + 1], mul3(dir, lengths[i]));
    }
    // 前向：根 → 固定
    pts[0] = { ...root };
    for (let i = 1; i < n; i++) {
      const dir = norm3(v3(pts[i], pts[i - 1]));
      pts[i] = add3(pts[i - 1], mul3(dir, lengths[i - 1]));
    }
    if (len3(v3(pts[n - 1], target)) < 1e-4) break;
  }
  return pts;
}
