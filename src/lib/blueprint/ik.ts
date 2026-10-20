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
