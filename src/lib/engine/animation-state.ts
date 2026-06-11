// ============================================================
// PixelMorpher - Animation State & Transforms
// Animation modifier state cache, phase computation,
// component-level blending
//
// NOTE: Pure helper functions (computeWheelTrajectory, computeGaitTransform,
// getAnimationFrameAndWeight, etc.) have been moved to
//   ./animation-handlers/shared-helpers.ts
// to break circular dependencies with the handler lookup tables.
// Dispatch functions (computeAnimationModifierTransform, etc.) have been
// moved to ./animation-dispatch.ts for the same reason.
// This file re-exports those functions for backward compatibility.
// ============================================================

import type {
  ModifierInstance,
  ModifierParamValue,
  AnimationModifierState,
  AnimationBlendMode,
  PartAnimationModifier,
  GaitPhase,
} from '../types';
import { ANIMATION_MODIFIER_TYPES } from '../types';
import type { ParamDriver } from '../types';
import { getAnimStateCache, getHashParams, getCheckpointInterval } from './frame-cache';
import { getAnimationFrameAndWeight } from './animation-handlers/shared-helpers';
import type { WheelAngularState } from './animation-handlers/shared-helpers';

// Re-export from shared-helpers for backward compatibility
// Only re-export symbols that are actually imported by other modules
export {
  getAnimationFrameAndWeight,
  getWheelSegmentAtFrame,
  getGaitPhaseAtFrame,
} from './animation-handlers/shared-helpers';
export type { WheelAngularState } from './animation-handlers/shared-helpers';

// NOTE: Dispatch functions (computeAnimationModifierTransform,
// computePartAnimationTransform, computeAnimModifierVelocity,
// computeGlobalModifierTransform) are in ./animation-dispatch.ts.
// They are NOT re-exported here to avoid creating a circular dependency
// via animation-dispatch → realtime-transform-handlers → animation-state.
// Import them from './animation-dispatch' directly, or from '../index'.

interface AnimationModifierCacheEntry {
  current: AnimationModifierState;
  checkpoints: Array<{
    frame: number;
    phase: number;
    angularVelocity: number;
    paramsHash: number; // hash of params to detect changes
    // V3.3: Wheel angular dynamics checkpoint state
    wheelAngle?: number;
    wheelOmega?: number;
    wheelAccelActive?: boolean;
    // V11: Gait phase checkpoint state
    gaitPhase?: GaitPhase;
    gaitPhaseStartFrame?: number;
  }>;
}

const _animStateCache = new Map<string, AnimationModifierCacheEntry>();

// LRU limit for animation state cache — prevents unbounded memory growth
// with many animation modifiers across long sessions
const _ANIM_STATE_CACHE_MAX = 512;

/** P4-4: Cache for allActiveDrivers in renderFrame — avoids scanning all keyframes every frame */
const _activeDriversCache: { keyframes: Keyframe[] | null; drivers: ParamDriver[] } = {
  keyframes: null,
  drivers: [],
};

// ============================================================
// B3: Keyframe index cache — avoid rebuilding kfByPart Map every frame
// Only rebuilds when keyframes array reference changes (new array = mutation happened)
// ============================================================
let _kfByPartCache: { keyframesRef: Keyframe[] | null; map: Map<string, Keyframe[]> } = {
  keyframesRef: null,
  map: new Map(),
};

// ============================================================
// B4: Modifier resolution LRU cache — avoid redundant per-part per-frame resolution
// Key: "partId:frame", Value: resolved modifiers array
// Cleared when keyframes reference changes
// ============================================================
const _modifierResolveCache = new Map<string, Keyframe>();
const _MODIFIER_RESOLVE_CACHE_MAX = 256;
let _modifierResolveCacheKeyframesRef: Keyframe[] | null = null;

// ============================================================
// B7: Persistent frame cache for onion skin and playback
// Key: frame number, Value: { canvas, keyframeHash }
// Survives across scrub cycles, only evicted on keyframe mutation
// ============================================================
const _frameRenderCache = new Map<number, { canvas: HTMLCanvasElement; keyframeHash: string }>();
const _FRAME_CACHE_MAX = 64;
let _frameCacheKeyframeHash: string = '';

// ============================================================
// B8: Part canvas dirty flag system — skip putImageData when part unchanged
// Tracks which part:frame combinations need rebuilding
// ============================================================
const _partDirtyFlags = new Map<string, boolean>();
let _partDirtyKeyframesRef: Keyframe[] | null = null;

/** Compute a hash of modifier params to detect changes — P2-2: cached with WeakMap */
const _hashCache = new WeakMap<object, number>();

function hashParams(params: Record<string, ModifierParamValue>): number {
  // P2-2: If the same params object reference is used, the hash can't have changed
  const cached = _hashCache.get(params);
  if (cached !== undefined) return cached;

  let hash = 0;
  const keys = Object.keys(params).sort();
  for (const k of keys) {
    const v = params[k];
    const s = `${k}:${v}`;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
  }
  const result = hash >>> 0;
  _hashCache.set(params, result);
  return result;
}

const CHECKPOINT_INTERVAL = 10; // Save checkpoint every 10 frames

// ============================================================
// V3.0: Incremental Phase Integration
// ============================================================

/**
 * Result of incremental phase computation for an animation modifier.
 * Provides both the phase (for oscillation) and time parameter (for decay).
 */
interface AnimationPhaseResult {
  /** Current oscillation phase in radians (including initial phase offset) */
  phase: number;
  /** Time parameter t = relativeFrame / period (for decay calculations) */
  t: number;
  /** Frame count since the modifier became active */
  relativeFrame: number;
  /** Effective range weight [0, 1] */
  weight: number;
}

/**
 * Compute the oscillation phase for an animation modifier using
 * incremental phase integration for smooth parameter changes.
 *
 * **Why incremental?**
 * The traditional formula `phase = 2π * relativeFrame / period` causes a
 * phase discontinuity when `period` changes mid-animation.
 * With incremental integration, phase advances by `2π / period` each frame,
 * so changing `period` only affects the *velocity* going forward — the
 * current position is preserved.
 *
 * **When to recompute from scratch:**
 * - Seeking (jumping to a non-adjacent frame)
 * - Modifier just became active (was inactive, now active)
 * - No cache entry exists yet
 *
 * **Baking uses the deterministic formula** (see computeAnimationModifierTransform),
 * not incremental integration, since baking may sample frames out of order.
 *
 * @param mod The modifier instance
 * @param currentFrame The current global frame number
 * @returns Phase result including phase angle, time parameter, and weight
 */
export function getAnimationPhase(mod: ModifierInstance | PartAnimationModifier, currentFrame: number): AnimationPhaseResult {
  const { relativeFrame, weight } = getAnimationFrameAndWeight(mod, currentFrame);

  const period = Math.max(2, Number(mod.params.period) || 16);
  const phaseRad = ((Number(mod.params.phase) || 0) * Math.PI) / 180;

  // Compute angular velocity based on modifier type
  let angularVelocity = 2 * Math.PI / period;
  if (mod.type === 'wheel') {
    const dir = mod.params.direction === 'ccw' ? -1 : 1;
    angularVelocity *= dir;
  }

  // Check cache for incremental update
  const cacheKey = mod.id;
  const cached = _animStateCache.get(cacheKey);
  const currentParamsHash = hashParams(mod.params);

  // LRU eviction: enforce max cache size for getAnimationPhase
  if (_animStateCache.size >= _ANIM_STATE_CACHE_MAX && !cached) {
    const firstKey = _animStateCache.keys().next().value;
    if (firstKey !== undefined) _animStateCache.delete(firstKey);
  }

  let rawPhase: number;

  if (weight <= 0) {
    // Modifier is inactive at this frame — don't update phase
    rawPhase = angularVelocity * relativeFrame;
    if (cached) {
      // Preserve cache but mark as inactive
      _animStateCache.set(cacheKey, {
        ...cached,
        current: {
          ...cached.current,
          lastFrame: currentFrame,
          wasActive: false,
        },
      });
    }
    return { phase: rawPhase + phaseRad, t: relativeFrame / period, relativeFrame, weight };
  }

  if (cached && cached.current.lastFrame === currentFrame - 1 && cached.current.wasActive) {
    // Normal playback (frame N → N+1): increment phase smoothly
    rawPhase = cached.current.phase + angularVelocity;

    // Save checkpoint periodically during forward playback
    // P7: Mutate checkpoints array in place instead of spreading to reduce GC pressure
    if (currentFrame % CHECKPOINT_INTERVAL === 0) {
      cached.checkpoints.push({
        frame: currentFrame,
        phase: rawPhase,
        angularVelocity,
        paramsHash: currentParamsHash,
      });
      if (cached.checkpoints.length > 50) {
        cached.checkpoints.splice(0, cached.checkpoints.length - 50);
      }
      _animStateCache.set(cacheKey, {
        current: {
          phase: rawPhase,
          angularVelocity,
          lastFrame: currentFrame,
          wasActive: true,
        },
        checkpoints: cached.checkpoints,
      });
    } else {
      _animStateCache.set(cacheKey, {
        current: {
          phase: rawPhase,
          angularVelocity,
          lastFrame: currentFrame,
          wasActive: true,
        },
        checkpoints: cached.checkpoints,
      });
    }
  } else if (cached && cached.current.lastFrame !== currentFrame - 1 && cached.checkpoints.length > 0) {
    // Seek (non-adjacent frame): find nearest checkpoint regardless of paramsHash.
    // V11: Removed paramsHash matching requirement — when period changes dynamically via
    // ParamDriver, every frame has a different hash, causing all checkpoints to be rejected
    // and falling back to the analytical formula which causes phase jumps.
    let bestCheckpoint = -1;
    let bestDist = Infinity;
    for (let i = 0; i < cached.checkpoints.length; i++) {
      const cp = cached.checkpoints[i];
      if (cp.frame <= currentFrame) {
        const dist = currentFrame - cp.frame;
        if (dist < bestDist) {
          bestDist = dist;
          bestCheckpoint = i;
        }
      }
    }

    if (bestCheckpoint >= 0) {
      // Integrate forward from checkpoint using its angularVelocity
      const cp = cached.checkpoints[bestCheckpoint];
      const framesToAdvance = currentFrame - cp.frame;
      rawPhase = cp.phase + cp.angularVelocity * framesToAdvance;
    } else {
      // All checkpoints are after currentFrame (shouldn't happen often)
      rawPhase = angularVelocity * relativeFrame;
    }

    // Save checkpoint on seek too — P7: mutate in place
    cached.checkpoints.push({
      frame: currentFrame,
      phase: rawPhase,
      angularVelocity,
      paramsHash: currentParamsHash,
    });
    if (cached.checkpoints.length > 50) {
      cached.checkpoints.splice(0, cached.checkpoints.length - 50);
    }

    _animStateCache.set(cacheKey, {
      current: {
        phase: rawPhase,
        angularVelocity,
        lastFrame: currentFrame,
        wasActive: true,
      },
      checkpoints: cached.checkpoints,
    });
  } else {
    // First activation or cache miss: compute from scratch
    rawPhase = angularVelocity * relativeFrame;
    _animStateCache.set(cacheKey, {
      current: {
        phase: rawPhase,
        angularVelocity,
        lastFrame: currentFrame,
        wasActive: true,
      },
      checkpoints: [{
        frame: currentFrame,
        phase: rawPhase,
        angularVelocity,
        paramsHash: currentParamsHash,
      }],
    });
  }

  return {
    phase: rawPhase + phaseRad,
    t: relativeFrame / period,
    relativeFrame,
    weight,
  };
}

// ============================================================
// V3.3: Wheel Angular Dynamics State Machine
// ============================================================

/**
 * Compute the wheel angular dynamics state using incremental integration
 * with the existing checkpoint system.
 *
 * **Mode 1: Direct velocity** (angularAcceleration is 0 or undefined)
 *   - angle = angularVelocity * (relativeFrame / frameRate)
 *   - Simple linear accumulation from velocity
 *
 * **Mode 2: State machine integration** (angularAcceleration is non-zero)
 *   - Uses incremental integration: ω(t+Δt) = ω(t) + α(t) × Δt, clamped by maxSpeed
 *   - Each frame: θ += ω × Δt
 *   - angularVelocity keyframes are IGNORED (only used as initial ω)
 *   - Uses cache for forward playback, checkpoints for seeking
 *
 * @param mod The modifier instance
 * @param currentFrame The current global frame number
 * @param frameRate Frames per second (for time conversion)
 */
export function getWheelAngularState(
  mod: ModifierInstance | PartAnimationModifier,
  currentFrame: number,
  frameRate: number,
): WheelAngularState {
  const angularVelocity = Number(mod.params.angularVelocity) || 0;
  const angularAcceleration = Number(mod.params.angularAcceleration) || 0;
  const maxSpeed = Number(mod.params.maxSpeed) || 720;

  const { relativeFrame, weight } = getAnimationFrameAndWeight(mod, currentFrame);
  const dt = 1 / frameRate; // seconds per frame

  // Default result (no rotation)
  const defaultResult: WheelAngularState = { angle: 0, omega: 0, accelActive: false };

  if (weight <= 0) {
    return defaultResult;
  }

  // Mode 1: Direct velocity (no acceleration)
  if (angularAcceleration === 0) {
    const angle = angularVelocity * (relativeFrame / frameRate);
    return { angle, omega: angularVelocity, accelActive: false };
  }

  // Mode 2: State machine integration (acceleration is non-zero)
  const cacheKey = mod.id;
  const cached = _animStateCache.get(cacheKey);
  const currentParamsHash = hashParams(mod.params);

  // LRU eviction for wheel state too
  if (_animStateCache.size >= _ANIM_STATE_CACHE_MAX && !cached) {
    const firstKey = _animStateCache.keys().next().value;
    if (firstKey !== undefined) _animStateCache.delete(firstKey);
  }

  // Helper to clamp omega by maxSpeed
  const clampOmega = (w: number) => Math.max(-maxSpeed, Math.min(maxSpeed, w));

  if (cached && cached.current.wheelAccelActive && cached.current.lastFrame === currentFrame - 1 && cached.current.wasActive) {
    // Normal playback (frame N → N+1): increment angular state
    const prevOmega = cached.current.wheelOmega ?? angularVelocity;
    const prevAngle = cached.current.wheelAngle ?? 0;

    // Integrate: ω += α × Δt, then clamp; θ += ω × Δt
    let newOmega = prevOmega + angularAcceleration * dt;
    newOmega = clampOmega(newOmega);
    const newAngle = prevAngle + newOmega * dt;

    // Update cache
    const newCurrent: AnimationModifierState = {
      ...cached.current,
      wheelAngle: newAngle,
      wheelOmega: newOmega,
      wheelAccelActive: true,
      lastFrame: currentFrame,
      wasActive: true,
    };

    // Save checkpoint periodically — P7: mutate in place
    if (currentFrame % CHECKPOINT_INTERVAL === 0) {
      cached.checkpoints.push({
        frame: currentFrame,
        phase: cached.current.phase,
        angularVelocity: cached.current.angularVelocity,
        paramsHash: currentParamsHash,
        wheelAngle: newAngle,
        wheelOmega: newOmega,
        wheelAccelActive: true,
      });
      if (cached.checkpoints.length > 50) {
        cached.checkpoints.splice(0, cached.checkpoints.length - 50);
      }
      _animStateCache.set(cacheKey, { current: newCurrent, checkpoints: cached.checkpoints });
    } else {
      _animStateCache.set(cacheKey, { current: newCurrent, checkpoints: cached.checkpoints });
    }

    return { angle: newAngle, omega: newOmega, accelActive: true };

  } else if (cached && cached.current.wheelAccelActive && cached.current.lastFrame !== currentFrame - 1 && cached.checkpoints.length > 0) {
    // Seek (non-adjacent frame): find nearest checkpoint with matching paramsHash
    let bestCheckpoint = -1;
    let bestDist = Infinity;
    for (let i = 0; i < cached.checkpoints.length; i++) {
      const cp = cached.checkpoints[i];
      if (cp.wheelAccelActive && cp.paramsHash === currentParamsHash && cp.frame <= currentFrame) {
        const dist = currentFrame - cp.frame;
        if (dist < bestDist) {
          bestDist = dist;
          bestCheckpoint = i;
        }
      }
    }

    let angle: number;
    let omega: number;

    if (bestCheckpoint >= 0) {
      // Integrate forward from checkpoint
      const cp = cached.checkpoints[bestCheckpoint];
      omega = cp.wheelOmega ?? angularVelocity;
      angle = cp.wheelAngle ?? 0;
      const framesToAdvance = currentFrame - cp.frame;
      for (let f = 0; f < framesToAdvance; f++) {
        omega = clampOmega(omega + angularAcceleration * dt);
        angle += omega * dt;
      }
    } else {
      // No matching checkpoint: simulate from frame 0
      omega = angularVelocity;
      angle = 0;
      for (let f = 0; f < relativeFrame; f++) {
        omega = clampOmega(omega + angularAcceleration * dt);
        angle += omega * dt;
      }
    }

    // Update cache with the new state
    const newCurrent: AnimationModifierState = {
      ...cached.current,
      wheelAngle: angle,
      wheelOmega: omega,
      wheelAccelActive: true,
      lastFrame: currentFrame,
      wasActive: true,
    };

    // Update cache with the new state — P7: mutate in place
    cached.checkpoints.push({
      frame: currentFrame,
      phase: cached.current.phase,
      angularVelocity: cached.current.angularVelocity,
      paramsHash: currentParamsHash,
      wheelAngle: angle,
      wheelOmega: omega,
      wheelAccelActive: true,
    });
    if (cached.checkpoints.length > 50) {
      cached.checkpoints.splice(0, cached.checkpoints.length - 50);
    }
    _animStateCache.set(cacheKey, { current: newCurrent, checkpoints: cached.checkpoints });

    return { angle, omega, accelActive: true };

  } else {
    // First activation or no wheel accel cache: simulate from frame 0
    let omega = angularVelocity; // Initial omega from angularVelocity param
    let angle = 0;
    for (let f = 0; f < relativeFrame; f++) {
      omega = clampOmega(omega + angularAcceleration * dt);
      angle += omega * dt;
    }

    // Initialize or update cache
    const existingCache = _animStateCache.get(cacheKey);
    const newCurrent: AnimationModifierState = {
      ...(existingCache?.current ?? {
        phase: 0,
        angularVelocity: 0,
        lastFrame: currentFrame,
        wasActive: true,
      }),
      wheelAngle: angle,
      wheelOmega: omega,
      wheelAccelActive: true,
      lastFrame: currentFrame,
      wasActive: true,
    };

    const checkpoints = existingCache ? [...existingCache.checkpoints, {
      frame: currentFrame,
      phase: newCurrent.phase,
      angularVelocity: newCurrent.angularVelocity,
      paramsHash: currentParamsHash,
      wheelAngle: angle,
      wheelOmega: omega,
      wheelAccelActive: true,
    }] : [{
      frame: currentFrame,
      phase: 0,
      angularVelocity: 0,
      paramsHash: currentParamsHash,
      wheelAngle: angle,
      wheelOmega: omega,
      wheelAccelActive: true,
    }];
    if (checkpoints.length > 50) {
      checkpoints.splice(0, checkpoints.length - 50);
    }
    _animStateCache.set(cacheKey, { current: newCurrent, checkpoints });

    return { angle, omega, accelActive: true };
  }
}

// ============================================================
// Keyframe base transform & component-level blending
// ============================================================

export function computeKeyframeBaseTransform(modifiers: ModifierInstance[]): {
  translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number;
  skews: Array<{ skewX: number; skewY: number }>;
} {
  let translateX = 0, translateY = 0, rotation = 0, scaleX = 1, scaleY = 1;
  const skews: Array<{ skewX: number; skewY: number }> = [];

  for (const mod of modifiers) {
    if (!mod.enabled) continue;
    // Skip animation modifiers — they're handled separately via part.animationModifiers
    if (ANIMATION_MODIFIER_TYPES.includes(mod.type)) continue;

    switch (mod.type) {
      case 'translate': {
        translateX += Number(mod.params.offsetX) || 0;
        translateY += Number(mod.params.offsetY) || 0;
        break;
      }
      case 'rotate': {
        const angle = Number(mod.params.angle) || 0;
        rotation += angle;
        // Pivot offset compensation: rotate around (Part.pivot + offset) instead of Part.pivot
        const pdx = Number(mod.params.pivotOffsetX) || 0;
        const pdy = Number(mod.params.pivotOffsetY) || 0;
        if (pdx !== 0 || pdy !== 0) {
          const rad = (angle * Math.PI) / 180;
          const cosA = Math.cos(rad);
          const sinA = Math.sin(rad);
          translateX += pdx - cosA * pdx + sinA * pdy;
          translateY += pdy - sinA * pdx - cosA * pdy;
        }
        break;
      }
      case 'uniform_scale': {
        const s = Number(mod.params.scale) || 1;
        scaleX *= s;
        scaleY *= s;
        // Pivot offset compensation: scale around (Part.pivot + offset) instead of Part.pivot
        const sdx = Number(mod.params.pivotOffsetX) || 0;
        const sdy = Number(mod.params.pivotOffsetY) || 0;
        if (sdx !== 0 || sdy !== 0) {
          translateX += sdx - s * sdx;
          translateY += sdy - s * sdy;
        }
        break;
      }
      case 'non_uniform_stretch': {
        scaleX *= Number(mod.params.scaleX) || 1;
        scaleY *= Number(mod.params.scaleY) || 1;
        break;
      }
      case 'skew': {
        skews.push({
          skewX: Number(mod.params.skewX) || 0,
          skewY: Number(mod.params.skewY) || 0,
        });
        break;
      }
    }
  }

  return { translateX, translateY, rotation, scaleX, scaleY, skews };
}

/** Combine keyframe base transform with animation transform using component-level blending.
 *  @param blendMode - How the animation transform combines with the keyframe base:
 *    - 'add' (default): Translation additive, rotation additive, scale multiplicative
 *    - 'converge': Animation influence diminishes over time (damping toward keyframe)
 *    - 'multiply': All components multiplicative
 *  @param convergeFactor - Only used when blendMode='converge'. Value in [0,1]:
 *    1 = full animation influence, 0 = converged to keyframe only.
 */
export function combineTransformsComponentLevel(
  kf: { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number },
  anim: { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number; weight: number },
  blendMode: AnimationBlendMode = 'add',
  convergeFactor?: number,
): { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number } {
  const w = anim.weight;

  if (blendMode === 'converge' && convergeFactor !== undefined) {
    // Converge: animation influence diminishes over time
    // convergeFactor: 1 = full anim influence, 0 = converged to keyframe only
    const cf = convergeFactor * w; // also apply weight from fade-in/out
    return {
      translateX: kf.translateX + anim.translateX * cf,
      translateY: kf.translateY + anim.translateY * cf,
      rotation: kf.rotation + anim.rotation * cf,
      scaleX: kf.scaleX * (1 + (anim.scaleX - 1) * cf),
      scaleY: kf.scaleY * (1 + (anim.scaleY - 1) * cf),
    };
  }

  if (blendMode === 'multiply') {
    // Multiply: all components are multiplicative
    const effectiveWeight = w;
    return {
      translateX: kf.translateX * (1 + (anim.scaleX - 1) * effectiveWeight) + anim.translateX * effectiveWeight,
      translateY: kf.translateY * (1 + (anim.scaleY - 1) * effectiveWeight) + anim.translateY * effectiveWeight,
      rotation: kf.rotation * (1 + anim.rotation / 360 * effectiveWeight),
      scaleX: kf.scaleX * (1 + (anim.scaleX - 1) * effectiveWeight),
      scaleY: kf.scaleY * (1 + (anim.scaleY - 1) * effectiveWeight),
    };
  }

  // Default 'add': Translation additive, rotation additive, scale multiplicative
  return {
    translateX: kf.translateX + anim.translateX * w,
    translateY: kf.translateY + anim.translateY * w,
    rotation: kf.rotation + anim.rotation * w,
    scaleX: kf.scaleX * (1 + (anim.scaleX - 1) * w),
    scaleY: kf.scaleY * (1 + (anim.scaleY - 1) * w),
  };
}
