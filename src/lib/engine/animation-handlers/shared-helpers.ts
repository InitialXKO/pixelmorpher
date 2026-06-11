// ============================================================
// PixelMorpher - Shared Animation Helpers
// Pure (stateless) functions extracted from animation-state.ts
// to break circular dependencies between animation-state.ts
// and the animation-handler lookup tables.
//
// This file MUST NOT import from animation-state.ts.
// It may only import from types.ts and other non-circular deps.
// ============================================================

import type {
  ModifierInstance,
  ModifierParamValue,
  PartAnimationModifier,
  GlobalModifier,
  WheelTrajectoryMode,
  GaitPhase,
} from '../../types';

// ============================================================
// Modifier weight & frame computation (pure — no cache)
// ============================================================

/**
 * Compute the effective weight for a modifier at a given frame.
 * Handles startFrame/endFrame range and fadeIn/fadeOut ramps.
 * Pure function — deterministic from inputs, no mutable state.
 */
export function computeModifierWeight(mod: ModifierInstance | PartAnimationModifier | GlobalModifier, currentFrame: number): number {
  const startFrame = mod.startFrame ?? -1;
  const endFrame = mod.endFrame ?? -1;
  const fadeInFrames = Math.max(0, mod.fadeInFrames ?? 0);
  const fadeOutFrames = Math.max(0, mod.fadeOutFrames ?? 0);

  // -1 means "always active" at that boundary
  const effectiveStart = startFrame === -1 ? 0 : startFrame;
  const effectiveEnd = endFrame === -1 ? Infinity : endFrame;

  // Outside effective range
  if (currentFrame < effectiveStart || currentFrame > effectiveEnd) {
    return 0;
  }

  let weight = 1;

  // Fade-in: from effectiveStart to effectiveStart + fadeInFrames
  if (fadeInFrames > 0 && currentFrame < effectiveStart + fadeInFrames) {
    const fadeProgress = (currentFrame - effectiveStart) / fadeInFrames;
    weight = Math.min(weight, fadeProgress);
  }

  // Fade-out: from effectiveEnd - fadeOutFrames to effectiveEnd
  if (fadeOutFrames > 0 && effectiveEnd !== Infinity && currentFrame > effectiveEnd - fadeOutFrames) {
    const fadeProgress = (effectiveEnd - currentFrame) / fadeOutFrames;
    weight = Math.min(weight, Math.max(0, fadeProgress));
  }

  // Clamp and round for very short fades (avoid sub-pixel flicker)
  if (weight >= 0.5 && weight < 1 && (fadeInFrames <= 1 || fadeOutFrames <= 1)) {
    weight = Math.round(weight);
  }

  return Math.max(0, Math.min(1, weight));
}

/**
 * Get the relative frame for an animation modifier.
 * If the modifier has an effective start frame, we compute the animation
 * relative to when the modifier becomes active, so the animation starts
 * from phase=0 at the activation frame.
 *
 * @returns { relativeFrame, weight } where relativeFrame is the frame count
 *   since the modifier became active, and weight is the effective range weight.
 */
export function getAnimationFrameAndWeight(mod: ModifierInstance | PartAnimationModifier, currentFrame: number): {
  relativeFrame: number;
  weight: number;
} {
  const weight = computeModifierWeight(mod, currentFrame);

  // Compute relative frame: if modifier has an explicit startFrame,
  // animation begins from that frame; otherwise from global frame 0
  const startFrame = mod.startFrame ?? -1;
  const activationFrame = startFrame === -1 ? 0 : startFrame;
  const relativeFrame = currentFrame - activationFrame;

  return { relativeFrame: Math.max(0, relativeFrame), weight };
}

// ============================================================
// Procedural result helper (pure)
// ============================================================

/**
 * Apply a procedural modifier's computed value to the appropriate transform component
 * based on the targetProperty parameter (translateX, translateY, rotation, scale).
 */
export function applyProceduralToResult(
  result: { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number },
  targetProperty: string,
  value: number,
): void {
  switch (targetProperty) {
    case 'translateX': result.translateX += value; break;
    case 'translateY': result.translateY += value; break;
    case 'rotation': result.rotation += value; break;
    case 'scale': result.scaleX = Math.max(0.01, result.scaleX + value / 10); result.scaleY = result.scaleX; break;
  }
}

// ============================================================
// V3.4: Wheel Trajectory Modes (pure — no mutable state)
// ============================================================

/**
 * Result of wheel trajectory computation.
 * Provides translation, rotation, and scale for the current frame.
 */
export interface WheelTrajectoryResult {
  translateX: number;
  translateY: number;
  rotation: number; // degrees
  scaleX: number;
  scaleY: number;
  /** Current trajectory segment (for UI indicator) */
  segment?: 'bottom' | 'right' | 'top' | 'left' | 'spin';
}

/**
 * Compute the wheel trajectory transform based on the trajectory mode.
 * This is deterministic from relativeFrame — no mutable state needed.
 *
 * Trajectory modes:
 * - 'circular': Standard circular/elliptical orbit. Body stays upright.
 * - 'caterpillar': Stadium/discorectangle path — flat bottom (ground contact),
 *   semicircle top. Like a tank tread or conveyor belt.
 * - 'rounded_rect': Rounded rectangle path. Four straight segments + four quarter-circle corners.
 * - 'tidal_lock': Circular orbit + body always faces the center (like the Moon).
 * - 'independent_spin': Pure self-rotation, no orbital translation.
 * - 'gear': Gear-mesh synchronized rotation with tooth count awareness.
 */
export function computeWheelTrajectory(opts: {
  radiusX: number;
  radiusY: number;
  relativeFrame: number;
  period: number;
  phaseRad: number;
  direction: number; // 1=cw, -1=ccw
  weight: number;
  trajectoryMode: WheelTrajectoryMode;
  cornerRadius: number;
  gearTeeth: number;
  gearMeshOffset: number;
}): WheelTrajectoryResult {
  const {
    radiusX, radiusY, relativeFrame, period, phaseRad, direction, weight,
    trajectoryMode, cornerRadius, gearTeeth, gearMeshOffset,
  } = opts;

  const periodSafe = Math.max(2, period);
  const frameInPeriod = ((relativeFrame % periodSafe) + periodSafe) % periodSafe;
  const normalizedT = frameInPeriod / periodSafe; // 0→1 within one period
  const baseAngle = (2 * Math.PI * normalizedT) * direction + phaseRad;

  switch (trajectoryMode) {
    // ======================================================================
    // 圆形/椭圆轨道 — standard cos/sin path, body stays upright
    // ======================================================================
    case 'circular':
    default: {
      return {
        translateX: radiusX * Math.cos(baseAngle) * weight,
        translateY: radiusY * Math.sin(baseAngle) * weight,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      };
    }

    // ======================================================================
    // 履带轨迹 — stadium/discorectangle: flat bottom + semicircle top
    //
    // Path (clockwise):
    //   1. Bottom straight: left → right  (y = +radiusY, ground level)
    //   2. Right semicircle: bottom-right → top-right
    //   3. Top straight: right → left  (y = -radiusY)
    //   4. Left semicircle: top-left → bottom-left
    //
    // Parameters: radiusX = half-width, radiusY = arc radius
    // ======================================================================
    case 'caterpillar': {
      const halfW = radiusX;     // half-width of the flat sections
      const arcR = radiusY;      // radius of the semicircular ends
      const bottomLen = 2 * halfW;
      const arcLen = Math.PI * arcR;
      const topLen = 2 * halfW;
      const totalLen = bottomLen + arcLen + topLen + arcLen;

      if (totalLen <= 0) {
        return { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      }

      // Distance traveled along the path (0 → totalLen)
      let dist = normalizedT * totalLen * direction;
      if (dist < 0) dist += totalLen; // normalize for ccw

      let x: number, y: number, seg: 'bottom' | 'right' | 'top' | 'left';

      if (dist < bottomLen) {
        // Bottom straight: left to right
        seg = 'bottom';
        const frac = dist / Math.max(1, bottomLen);
        x = -halfW + 2 * halfW * frac;
        y = arcR;
      } else if (dist < bottomLen + arcLen) {
        // Right semicircle: from bottom-right going up to top-right
        seg = 'right';
        const arcDist = dist - bottomLen;
        const arcAngle = arcDist / Math.max(0.001, arcR); // 0 → π
        x = halfW + arcR * Math.sin(arcAngle);
        y = arcR * Math.cos(arcAngle);
      } else if (dist < bottomLen + arcLen + topLen) {
        // Top straight: right to left
        seg = 'top';
        const topDist = dist - bottomLen - arcLen;
        const frac = topDist / Math.max(1, topLen);
        x = halfW - 2 * halfW * frac;
        y = -arcR;
      } else {
        // Left semicircle: from top-left going down to bottom-left
        seg = 'left';
        const arcDist = dist - bottomLen - arcLen - topLen;
        const arcAngle = arcDist / Math.max(0.001, arcR); // 0 → π
        x = -halfW - arcR * Math.sin(arcAngle);
        y = -arcR * Math.cos(arcAngle);
      }

      // Center the path around origin (shift so center of stadium is at 0,0)
      return {
        translateX: x * weight,
        translateY: (y - (arcR > 0 ? 0 : 0)) * weight, // already centered vertically
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        segment: seg,
      };
    }

    // ======================================================================
    // 圆角矩形轨迹 — rounded rectangle path
    //
    // Path segments (8 total, clockwise):
    //   1. Bottom straight
    //   2. Bottom-right quarter circle
    //   3. Right straight
    //   4. Top-right quarter circle
    //   5. Top straight
    //   6. Top-left quarter circle
    //   7. Left straight
    //   8. Bottom-left quarter circle
    //
    // Parameters: radiusX = half-width, radiusY = half-height, cornerRadius
    // ======================================================================
    case 'rounded_rect': {
      const halfW = radiusX;
      const halfH = radiusY;
      const cr = Math.min(cornerRadius, halfW, halfH); // clamp corner radius

      // Lengths of each segment type
      const straightH = 2 * Math.max(0, halfW - cr); // horizontal straight length
      const straightV = 2 * Math.max(0, halfH - cr); // vertical straight length
      const quarterArc = (Math.PI / 2) * cr;         // quarter circle arc length

      const totalLen = 2 * straightH + 2 * straightV + 4 * quarterArc;

      if (totalLen <= 0) {
        return { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      }

      // Walk along the path
      let dist = normalizedT * totalLen * direction;
      if (dist < 0) dist += totalLen;

      let x: number, y: number, seg: 'bottom' | 'right' | 'top' | 'left' = 'bottom';

      // Segment boundaries (cumulative distances)
      const s1 = straightH;                           // end of bottom straight
      const s2 = s1 + quarterArc;                     // end of bottom-right corner
      const s3 = s2 + straightV;                      // end of right straight
      const s4 = s3 + quarterArc;                     // end of top-right corner
      const s5 = s4 + straightH;                      // end of top straight
      const s6 = s5 + quarterArc;                     // end of top-left corner
      const s7 = s6 + straightV;                      // end of left straight
      // s8 = totalLen (bottom-left corner, back to start)

      if (dist < s1) {
        // Bottom straight: left to right
        seg = 'bottom';
        const frac = straightH > 0 ? dist / straightH : 0;
        x = -halfW + cr + (2 * (halfW - cr)) * frac;
        y = halfH;
      } else if (dist < s2) {
        // Bottom-right quarter circle
        seg = 'bottom'; // transition
        const arcDist = dist - s1;
        const arcAngle = quarterArc > 0 ? arcDist / cr : 0; // 0 → π/2
        x = (halfW - cr) + cr * Math.sin(arcAngle);
        y = (halfH - cr) + cr * Math.cos(arcAngle);
      } else if (dist < s3) {
        // Right straight: bottom to top
        seg = 'right';
        const segDist = dist - s2;
        const frac = straightV > 0 ? segDist / straightV : 0;
        x = halfW;
        y = (halfH - cr) - (2 * (halfH - cr)) * frac;
      } else if (dist < s4) {
        // Top-right quarter circle
        seg = 'right'; // transition
        const arcDist = dist - s3;
        const arcAngle = quarterArc > 0 ? arcDist / cr : 0; // 0 → π/2
        x = (halfW - cr) + cr * Math.cos(arcAngle);
        y = -(halfH - cr) - cr * Math.sin(arcAngle);
      } else if (dist < s5) {
        // Top straight: right to left
        seg = 'top';
        const segDist = dist - s4;
        const frac = straightH > 0 ? segDist / straightH : 0;
        x = (halfW - cr) - (2 * (halfW - cr)) * frac;
        y = -halfH;
      } else if (dist < s6) {
        // Top-left quarter circle
        seg = 'top'; // transition
        const arcDist = dist - s5;
        const arcAngle = quarterArc > 0 ? arcDist / cr : 0; // 0 → π/2
        x = -(halfW - cr) - cr * Math.sin(arcAngle);
        y = -(halfH - cr) - cr * Math.cos(arcAngle);
      } else if (dist < s7) {
        // Left straight: top to bottom
        seg = 'left';
        const segDist = dist - s6;
        const frac = straightV > 0 ? segDist / straightV : 0;
        x = -halfW;
        y = -(halfH - cr) + (2 * (halfH - cr)) * frac;
      } else {
        // Bottom-left quarter circle
        seg = 'left'; // transition
        const arcDist = dist - s7;
        const arcAngle = quarterArc > 0 ? arcDist / cr : 0; // 0 → π/2
        x = -(halfW - cr) - cr * Math.cos(arcAngle);
        y = (halfH - cr) + cr * Math.sin(arcAngle);
      }

      return {
        translateX: x * weight,
        translateY: y * weight,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        segment: seg,
      };
    }

    // ======================================================================
    // 潮汐锁定 — circular orbit + body always faces center
    // Like the Moon always showing the same face to Earth.
    // rotation = orbital angle (body tracks the radial direction)
    // ======================================================================
    case 'tidal_lock': {
      const x = radiusX * Math.cos(baseAngle);
      const y = radiusY * Math.sin(baseAngle);
      // Rotation = orbital angle so one face always points toward center
      // Convert orbital angle to degrees; add 90° so "top" of sprite faces center
      const rotationDeg = (baseAngle * 180 / Math.PI) + 90;
      return {
        translateX: x * weight,
        translateY: y * weight,
        rotation: rotationDeg * weight,
        scaleX: 1,
        scaleY: 1,
      };
    }

    // ======================================================================
    // 独立自转 — pure self-rotation, no orbital translation
    // Like a spinning wheel, fan blade, etc.
    // Uses period/phase/direction for rotation speed, ignores radiusX/radiusY
    // ======================================================================
    case 'independent_spin': {
      const rotationDeg = (baseAngle * 180) / Math.PI;
      return {
        translateX: 0,
        translateY: 0,
        rotation: rotationDeg * weight,
        scaleX: 1,
        scaleY: 1,
        segment: 'spin',
      };
    }

    // ======================================================================
    // 齿轮对位 — gear-mesh synchronized rotation
    //
    // Like independent_spin but with tooth-count awareness for synchronization:
    // - gearTeeth: number of teeth (affects visual cogging amplitude)
    // - gearMeshOffset: 0 = teeth aligned, 0.5 = half-tooth offset for meshing
    //
    // The rotation has slight sinusoidal cogging at each tooth position,
    // giving a mechanical gear feel. When two gears are adjacent with
    // meshOffset = 0.5 and opposite directions, their teeth interleave.
    // ======================================================================
    case 'gear': {
      const teeth = Math.max(2, gearTeeth);
      const meshOff = gearMeshOffset; // 0..1

      // Base rotation from period/phase/direction
      const baseRotationDeg = (baseAngle * 180) / Math.PI;

      // Cogging: slight sinusoidal variation at each tooth position
      // Amplitude is small (2°) to give mechanical feel without distorting
      const coggingAmplitude = 2; // degrees
      const cogging = Math.sin((baseRotationDeg + meshOff * (360 / teeth)) * teeth * Math.PI / 180) * coggingAmplitude;

      return {
        translateX: 0,
        translateY: 0,
        rotation: (baseRotationDeg + cogging) * weight,
        scaleX: 1,
        scaleY: 1,
        segment: 'spin',
      };
    }
  }
}

/**
 * Determine which trajectory segment we're in at a given frame.
 * Returns undefined for modes without segments (circular, tidal_lock).
 * Exported for use in UI phase indicator.
 */
export function getWheelSegmentAtFrame(
  relativeFrame: number,
  period: number,
  trajectoryMode: WheelTrajectoryMode,
  radiusX: number,
  radiusY: number,
  cornerRadius: number,
): 'bottom' | 'right' | 'top' | 'left' | 'spin' | undefined {
  if (trajectoryMode === 'independent_spin' || trajectoryMode === 'gear') {
    return 'spin';
  }
  if (trajectoryMode === 'circular' || trajectoryMode === 'tidal_lock') {
    return undefined;
  }

  // For caterpillar and rounded_rect, compute the trajectory and extract segment
  const periodSafe = Math.max(2, period);
  const frameInPeriod = ((relativeFrame % periodSafe) + periodSafe) % periodSafe;
  const normalizedT = frameInPeriod / periodSafe;

  if (trajectoryMode === 'caterpillar') {
    const halfW = radiusX;
    const arcR = radiusY;
    const bottomLen = 2 * halfW;
    const arcLen = Math.PI * arcR;
    const topLen = 2 * halfW;
    const totalLen = bottomLen + arcLen + topLen + arcLen;
    if (totalLen <= 0) return undefined;
    const dist = normalizedT * totalLen;
    if (dist < bottomLen) return 'bottom';
    if (dist < bottomLen + arcLen) return 'right';
    if (dist < bottomLen + arcLen + topLen) return 'top';
    return 'left';
  }

  if (trajectoryMode === 'rounded_rect') {
    const halfW = radiusX;
    const halfH = radiusY;
    const cr = Math.min(cornerRadius, halfW, halfH);
    const straightH = 2 * Math.max(0, halfW - cr);
    const straightV = 2 * Math.max(0, halfH - cr);
    const quarterArc = (Math.PI / 2) * cr;
    const totalLen = 2 * straightH + 2 * straightV + 4 * quarterArc;
    if (totalLen <= 0) return undefined;
    const dist = normalizedT * totalLen;
    const s1 = straightH;
    const s2 = s1 + quarterArc;
    const s3 = s2 + straightV;
    const s4 = s3 + quarterArc;
    const s5 = s4 + straightH;
    const s6 = s5 + quarterArc;
    const s7 = s6 + straightV;
    if (dist < s1 || dist < s2) return 'bottom';
    if (dist < s4) return 'right';
    if (dist < s6) return 'top';
    return 'left';
  }

  return undefined;
}

// ============================================================
// V3.3: Wheel Angular Dynamics — deterministic (no cache)
// ============================================================

/**
 * Result of wheel angular dynamics computation.
 * Provides the current rotation angle and angular velocity.
 */
export interface WheelAngularState {
  /** Current rotation angle in degrees */
  angle: number;
  /** Current angular velocity in degrees/second */
  omega: number;
  /** Whether acceleration mode is active */
  accelActive: boolean;
}

/**
 * Compute wheel angular dynamics state deterministically (no cache).
 * Used by bake-to-timeline which may sample frames out of order.
 *
 * For Mode 1 (direct velocity): θ = angularVelocity * (relativeFrame / frameRate)
 * For Mode 2 (acceleration): simulate from frame 0 to currentFrame step by step
 */
export function computeWheelAngularStateDeterministic(
  mod: ModifierInstance | PartAnimationModifier,
  currentFrame: number,
  frameRate: number,
): WheelAngularState {
  const angularVelocity = Number(mod.params.angularVelocity) || 0;
  const angularAcceleration = Number(mod.params.angularAcceleration) || 0;
  const maxSpeed = Number(mod.params.maxSpeed) || 720;

  const { relativeFrame, weight } = getAnimationFrameAndWeight(mod, currentFrame);
  const dt = 1 / frameRate;

  if (weight <= 0) {
    return { angle: 0, omega: 0, accelActive: false };
  }

  // Mode 1: Direct velocity
  if (angularAcceleration === 0) {
    const angle = angularVelocity * (relativeFrame / frameRate);
    return { angle, omega: angularVelocity, accelActive: false };
  }

  // Mode 2: Simulate from frame 0
  const clampOmega = (w: number) => Math.max(-maxSpeed, Math.min(maxSpeed, w));
  let omega = angularVelocity;
  let angle = 0;
  for (let f = 0; f < relativeFrame; f++) {
    omega = clampOmega(omega + angularAcceleration * dt);
    angle += omega * dt;
  }

  return { angle, omega, accelActive: true };
}

// ============================================================
// V11: Gait Animation Modifier — Semicircle + Chord Trajectory
// ============================================================

/**
 * Determine which gait phase (stance or swing) we're in at a given point
 * in the gait cycle. Pure function — deterministic from inputs.
 */
export function getGaitPhaseAtFrame(
  relativeFrame: number,
  period: number,
  stanceRatio: number,
): GaitPhase {
  const periodSafe = Math.max(4, period);
  const frameInPeriod = ((relativeFrame % periodSafe) + periodSafe) % periodSafe;
  const normalizedT = frameInPeriod / periodSafe;
  const stanceEnd = Math.max(0.15, Math.min(0.85, stanceRatio));
  return normalizedT < stanceEnd ? 'stance' : 'swing';
}

/**
 * Compute the gait angle at a given swing progress using the specified easing.
 * The angle transitions from liftoffAngle through peakAngle to contactAngle
 * as swing progress goes from 0 to 1.
 */
function computeGaitSwingAngle(
  sw: number,
  liftoffAngle: number,
  peakAngle: number,
  contactAngle: number,
  angleEasing: string,
): number {
  // Piecewise: 0→0.5 interpolates liftoffAngle→peakAngle, 0.5→1 interpolates peakAngle→contactAngle
  let t: number;
  if (sw <= 0.5) {
    const halfSw = sw * 2; // 0→1 over first half
    switch (angleEasing) {
      case 'linear':
        t = halfSw;
        break;
      case 'ease_in_out':
        t = 3 * halfSw * halfSw - 2 * halfSw * halfSw * halfSw;
        break;
      case 'sine':
      default:
        t = 0.5 - 0.5 * Math.cos(halfSw * Math.PI);
        break;
    }
    return liftoffAngle + (peakAngle - liftoffAngle) * t;
  } else {
    const halfSw = (sw - 0.5) * 2; // 0→1 over second half
    switch (angleEasing) {
      case 'linear':
        t = halfSw;
        break;
      case 'ease_in_out':
        t = 3 * halfSw * halfSw - 2 * halfSw * halfSw * halfSw;
        break;
      case 'sine':
      default:
        t = 0.5 - 0.5 * Math.cos(halfSw * Math.PI);
        break;
    }
    return peakAngle + (contactAngle - peakAngle) * t;
  }
}

/**
 * Compute the gait trajectory and deformation transform.
 * This is a pure function — deterministic from inputs.
 *
 * Gait styles:
 * - 'cartoon': Classic D-shape — semicircle arc (swing) + chord (stance).
 *   Body stays level, no aerial phase.
 * - 'slow_walk': Flat elliptical arc + chord. Gentle vertical oscillation.
 *   Bottom of trajectory overlaps Y=0 during stance. No aerial phase.
 * - 'run': Teardrop/water-drop arc + chord. Asymmetric swing trajectory
 *   with the teardrop tip pointing backward at the start of forward swing.
 *   Larger vertical amplitude. Aerial phase exists when both feet are Y>0
 *   (controlled by aerialRatio parameter).
 * - 'paddle': Inverted D-shape — semicircle arc (swing/power, goes DOWN)
 *   + chord (stance/recovery, at surface Y=0). Opposite of cartoon walk:
 *   the arc is below the chord. Used for swimming/paddling motions where
 *   the limb pushes down and back during power phase, then returns forward
 *   along the surface during recovery. No aerial phase.
 *
 * Walk/swim styles share:
 * - Stance phase: foot on ground (walk) or limb at surface (paddle),
 *   traces chord — forward for paddle, backward for walk
 * - Swing phase: foot in air (walk) or limb in water (paddle),
 *   traces an arc — upward for walk, downward for paddle
 * - Aerial angle adjustment during swing
 * - Landing/liftoff bend deformation
 */
export function computeGaitTransform(opts: {
  normalizedT: number;
  period: number;
  weight: number;
  strideLength: number;
  liftHeight: number;
  stanceRatio: number;
  direction: string;
  gaitStyle: string;
  aerialRatio: number;
  teardropAsymmetry: number;
  liftoffAngle: number;
  peakAngle: number;
  contactAngle: number;
  angleEasing: string;
  landBend: number;
  landBendDuration: number;
  liftoffBend: number;
  liftoffBendDuration: number;
}): { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number } {
  const {
    normalizedT, period, weight,
    strideLength, liftHeight, stanceRatio,
    direction, gaitStyle, aerialRatio, teardropAsymmetry,
    liftoffAngle, peakAngle, contactAngle, angleEasing,
    landBend, landBendDuration,
    liftoffBend, liftoffBendDuration,
  } = opts;

  const periodSafe = Math.max(4, period);

  // normalizedT is already computed by the caller (from accumulated phase or analytical formula).
  // It represents position within the gait cycle [0, 1), with phase offset already applied.
  const shiftedT = ((normalizedT % 1) + 1) % 1;

  const stanceEnd = Math.max(0.15, Math.min(0.85, stanceRatio));
  const dirMult = direction === 'backward' ? -1 : 1;

  let tx: number;
  let ty: number;
  let rot = 0;
  let sy = 1;
  let sx = 1;

  if (shiftedT < stanceEnd) {
    // ================================================================
    // STANCE phase: chord trajectory
    // Walk: foot on ground, slides backward (front → back)
    // Paddle: limb at surface, returns forward (back → front)
    // ================================================================
    const stanceProgress = stanceEnd > 0 ? shiftedT / stanceEnd : 0; // 0→1
    if (gaitStyle === 'paddle') {
      // Recovery: limb moves forward along surface (reversed direction)
      tx = dirMult * (strideLength / 2) * (2 * stanceProgress - 1);
    } else {
      // Walk/run: foot slides backward on ground
      tx = dirMult * (strideLength / 2) * (1 - 2 * stanceProgress);
    }
    ty = 0;

    // Liftoff bend deformation: at the end of stance (toe-off transition)
    if (liftoffBend > 0 && liftoffBendDuration > 0) {
      const liftoffBendRatio = liftoffBendDuration / periodSafe;
      const liftoffStart = stanceEnd - liftoffBendRatio;
      if (shiftedT >= liftoffStart && shiftedT < stanceEnd) {
        const bendProgress = (shiftedT - liftoffStart) / liftoffBendRatio;
        const envelope = Math.sin(bendProgress * Math.PI / 2);
        sy = 1 + liftoffBend * envelope * 0.5;
        rot = -liftoffBend * envelope * 15 * dirMult;
      }
    }

  } else {
    // ================================================================
    // SWING phase: foot in air, arc trajectory
    // ================================================================
    const swingRange = 1 - stanceEnd;
    const sw = swingRange > 0 ? (shiftedT - stanceEnd) / swingRange : 0; // 0→1

    switch (gaitStyle) {

      // ==============================================================
      // 卡通行走 — classic D-shape semicircle + chord
      // ==============================================================
      case 'cartoon':
      default: {
        tx = dirMult * (strideLength / 2) * (-Math.cos(sw * Math.PI));
        ty = -liftHeight * Math.sin(sw * Math.PI);
        break;
      }

      // ==============================================================
      // 慢走 — flat elliptical arc + chord
      // 扁而平缓的椭圆弧，sin^0.6 使顶部更宽阔平坦
      // ==============================================================
      case 'slow_walk': {
        tx = dirMult * (strideLength / 2) * (-Math.cos(sw * Math.PI));
        ty = -liftHeight * Math.pow(Math.sin(sw * Math.PI), 0.6);
        break;
      }

      // ==============================================================
      // 奔跑 — teardrop/water-drop arc + chord
      // 水滴尖端指向后方：tipOffset = asym · sin(π·sw) · (1-sw)
      // Y 用 sin^1.4 形成更高更尖的弧形
      // ==============================================================
      case 'run': {
        const asym = teardropAsymmetry;
        const baseX = -Math.cos(sw * Math.PI);
        const tipOffset = asym * Math.sin(sw * Math.PI) * (1 - sw);
        tx = dirMult * (strideLength / 2) * (baseX - tipOffset);
        ty = -liftHeight * Math.pow(Math.sin(sw * Math.PI), 1.4);
        break;
      }

      // ==============================================================
      // 划桨/游泳 — inverted D-shape: arc goes DOWN, chord at top
      // 与卡通行走相反：圆弧在下（划水/推水），弦在上（恢复/回摆）
      // X 方向与行走一致：cos(π·sw) 使足端从前方入水划向后方
      // Y 方向反转：+liftHeight 使肢体向下潜入
      // ==============================================================
      case 'paddle': {
        tx = dirMult * (strideLength / 2) * Math.cos(sw * Math.PI);
        ty = liftHeight * Math.sin(sw * Math.PI);
        break;
      }
    }

    // Aerial angle adjustment during swing
    rot = computeGaitSwingAngle(sw, liftoffAngle, peakAngle, contactAngle, angleEasing) * dirMult;

    // Landing bend deformation: at the end of swing (heel-strike transition)
    if (landBend > 0 && landBendDuration > 0) {
      const landBendRatio = landBendDuration / periodSafe;
      const landStart = 1 - landBendRatio;
      if (sw >= landStart) {
        const bendProgress = (sw - landStart) / landBendRatio;
        const envelope = 1 - Math.cos(bendProgress * Math.PI / 2);
        sy = 1 - landBend * envelope * 0.5;
        rot += landBend * envelope * 10 * dirMult;
      }
    }
  }

  // Apply weight
  return {
    translateX: tx * weight,
    translateY: ty * weight,
    rotation: rot * weight,
    scaleX: 1 + (sx - 1) * weight,
    scaleY: 1 + (sy - 1) * weight,
  };
}
