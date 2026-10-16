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
