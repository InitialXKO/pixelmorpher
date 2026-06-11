// ============================================================
// PixelMorpher - Animation Dispatch
// Functions that dispatch to the handler lookup tables for
// computing animation transforms. Extracted from animation-state.ts
// to break circular dependencies:
//
//   animation-state.ts  →  handler files  (for lookup tables)
//   handler files       →  animation-state.ts  (for helpers)
//
// By moving the dispatch code here, animation-state.ts no longer
// imports from handler files, breaking the cycle.
//
// Dependency graph (all one-way, no cycles):
//   animation-dispatch.ts  →  animation-state.ts  (cache-dependent fns)
//   animation-dispatch.ts  →  shared-helpers.ts    (pure helpers)
//   animation-dispatch.ts  →  handler files        (lookup tables)
//   handler files          →  shared-helpers.ts    (pure helpers)
//   handler files          →  animation-state.ts   (cache-dependent fns)
// ============================================================

import type {
  AnimationBlendMode,
  PartAnimationModifier,
  ModifierInstance,
  GlobalModifier,
} from '../types';
import { ANIMATION_MODIFIER_TYPES } from '../types';
import { resolveAnimModifierParams } from './param-driver';

import { getAnimationFrameAndWeight, computeModifierWeight } from './animation-handlers/shared-helpers';
import { BAKE_TRANSFORM_HANDLERS } from './animation-handlers/bake-transform-handlers';
import { REALTIME_TRANSFORM_HANDLERS } from './animation-handlers/realtime-transform-handlers';
import { GLOBAL_TRANSFORM_HANDLERS } from './animation-handlers/global-transform-handlers';
import type { BakeTransformContext, RealtimeTransformContext, GlobalTransformContext, RealtimeTransformResult } from './animation-handlers/types';
import { DEFAULT_REALTIME_RESULT } from './animation-handlers/types';

// ============================================================
// V3.0: Compute Animation Modifier Transform (for bake-to-timeline)
// ============================================================

/**
 * Compute the transform values produced by a single animation modifier
 * at a given frame, without applying them to a canvas context.
 * Used by bake-to-timeline to sample modifier output into keyframes.
 * V3.2: Supports converge blend mode — when blendMode='converge', the
 * animation influence is dampened by the converge factor.
 */
export function computeAnimationModifierTransform(
  mod: ModifierInstance | PartAnimationModifier,
  currentFrame: number,
  frameRate: number = 12,
): { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number } {
  const result = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };

  if (!mod.enabled) return result;
  if (!ANIMATION_MODIFIER_TYPES.includes(mod.type)) return result;

  const { relativeFrame, weight } = getAnimationFrameAndWeight(mod, currentFrame);
  if (weight <= 0) return result;

  // V3.2: Compute converge factor if this modifier uses converge blend mode
  const blendMode = (mod as PartAnimationModifier).blendMode || 'add';
  let convergeFactor = 1;
  if (blendMode === 'converge') {
    const convergeSpeed = Number(mod.params.convergeSpeed) || 0.5;
    const period = Math.max(2, Number(mod.params.period) || 16);
    const t = relativeFrame / period;
    convergeFactor = Math.exp(-convergeSpeed * t);
  }

  // The effective weight includes converge factor
  const effectiveWeight = weight * convergeFactor;

  // Dispatch to the handler for this modifier type
  const handler = BAKE_TRANSFORM_HANDLERS[mod.type];
  if (handler) {
    const ctx: BakeTransformContext = { relativeFrame, weight, effectiveWeight, frameRate, currentFrame };
    const partial = handler(mod, ctx);
    Object.assign(result, partial);
  }

  return result;
}

// ============================================================
// V3.0: Animation Modifier Blend Mode Application
// ============================================================

/**
 * Compute the transform values produced by an animation modifier at a given frame,
 * using incremental phase integration for smooth parameter changes.
 * This is the REAL-TIME rendering path (uses cached phase state).
 */
function computeAnimModifierRealtimeTransform(mod: ModifierInstance | PartAnimationModifier, currentFrame: number, frameRate: number = 12): {
  translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number;
  weight: number; convergeFactor: number;
} {
  const result: RealtimeTransformResult = { ...DEFAULT_REALTIME_RESULT };

  if (!mod.enabled || !ANIMATION_MODIFIER_TYPES.includes(mod.type)) return result;

  // V3.2: Compute converge factor for this modifier
  const modBlend = (mod as PartAnimationModifier).blendMode || 'add';
  let convergeFactor = 1;
  if (modBlend === 'converge') {
    const { relativeFrame: cRelFrame, weight: cWeight } = getAnimationFrameAndWeight(mod, currentFrame);
    if (cWeight > 0) {
      const convergeSpeed = Number(mod.params.convergeSpeed) || 0.5;
      const period = Math.max(2, Number(mod.params.period) || 16);
      const t = cRelFrame / period;
      convergeFactor = Math.exp(-convergeSpeed * t);
    }
  }
  result.convergeFactor = convergeFactor;

  // Dispatch to the handler for this modifier type
  const handler = REALTIME_TRANSFORM_HANDLERS[mod.type];
  if (handler) {
    const { relativeFrame, weight } = getAnimationFrameAndWeight(mod, currentFrame);
    const effectiveWeight = weight * convergeFactor;
    const ctx: RealtimeTransformContext = {
      relativeFrame, weight, effectiveWeight, convergeFactor, frameRate, currentFrame,
    };
    const partial = handler(mod, ctx);
    if (partial) {
      Object.assign(result, partial);
      // If the handler didn't set convergeFactor, preserve the one we computed
      if (partial.convergeFactor === undefined) {
        result.convergeFactor = convergeFactor;
      }
    } else {
      // Handler returned null (e.g. weight <= 0) — keep default zero result
      result.convergeFactor = convergeFactor;
    }
  }

  return result;
}

/** Compute animation transform from part-level animation modifiers.
 *  Returns the accumulated transform plus the dominant blend mode and
 *  converge factor (if any modifier uses converge mode).
 */
export function computePartAnimationTransform(
  animModifiers: PartAnimationModifier[],
  currentFrame: number,
  frameRate: number = 12,
): {
  translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number;
  weight: number; blendMode: AnimationBlendMode; convergeFactor: number;
} {
  let translateX = 0, translateY = 0, rotation = 0, scaleX = 1, scaleY = 1;
  let maxWeight = 0;

  // V3.2: Determine dominant blend mode and compute converge factor
  // Priority: if any enabled modifier uses 'converge', use converge mode.
  // Otherwise, if any uses 'multiply', use multiply. Otherwise 'add'.
  let hasConverge = false;
  let hasMultiply = false;
  let convergeSpeedSum = 0;
  let convergeCount = 0;

  for (const mod of animModifiers) {
    if (!mod.enabled) continue;
    const modBlend = (mod as PartAnimationModifier).blendMode || 'add';
    if (modBlend === 'converge') {
      hasConverge = true;
      convergeSpeedSum += Number(mod.params.convergeSpeed) || 0.5;
      convergeCount++;
    } else if (modBlend === 'multiply') {
      hasMultiply = true;
    }
  }

  const dominantBlendMode: AnimationBlendMode = hasConverge ? 'converge' : (hasMultiply ? 'multiply' : 'add');

  // Compute converge factor: exponential decay based on time
  // converge_factor = exp(-convergeSpeed * relativeFrame / period)
  // We use the average convergeSpeed across all converge-mode modifiers
  let convergeFactor = 1; // default: full influence (no convergence)
  if (hasConverge && convergeCount > 0) {
    const avgConvergeSpeed = convergeSpeedSum / convergeCount;
    // Use the first converge modifier's relative frame and period for time calculation
    const firstConvergeMod = animModifiers.find(m => m.enabled && (m.blendMode || 'add') === 'converge');
    if (firstConvergeMod) {
      const { relativeFrame } = getAnimationFrameAndWeight(firstConvergeMod, currentFrame);
      const period = Math.max(2, Number(firstConvergeMod.params.period) || 16);
      const t = relativeFrame / period;
      convergeFactor = Math.exp(-avgConvergeSpeed * t);
    }
  }

  for (const rawMod of animModifiers) {
    if (!rawMod.enabled) continue;
    // M7: Resolve paramKeyframes/paramDrivers before computing transform
    const mod = resolveAnimModifierParams(rawMod, currentFrame);
    const transform = computeAnimModifierRealtimeTransform(mod, currentFrame, frameRate);
    if (transform.weight <= 0) continue;

    // Pivot offset compensation for animation modifiers that produce rotation/scale
    const pdx = Number(mod.params.pivotOffsetX) || 0;
    const pdy = Number(mod.params.pivotOffsetY) || 0;
    let compX = 0, compY = 0;
    if ((pdx !== 0 || pdy !== 0) && (transform.rotation !== 0 || transform.scaleX !== 1 || transform.scaleY !== 1)) {
      // Rotation compensation
      if (transform.rotation !== 0) {
        const rad = (transform.rotation * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        compX += pdx - cosA * pdx + sinA * pdy;
        compY += pdy - sinA * pdx - cosA * pdy;
      }
      // Scale compensation (subtract what rotation already contributed)
      if (transform.scaleX !== 1 || transform.scaleY !== 1) {
        compX += pdx * (1 - transform.scaleX);
        compY += pdy * (1 - transform.scaleY);
      }
    }

    // Accumulate using component-level blending internally too
    // Note: convergeFactor is already applied inside computeAnimModifierRealtimeTransform
    // via effectiveWeight = weight * convergeFactor, so the accumulated result already
    // reflects convergence. The outer convergeFactor is set to 1 to avoid double-dipping.
    translateX += transform.translateX + compX;
    translateY += transform.translateY + compY;
    rotation += transform.rotation;
    scaleX *= transform.scaleX;
    scaleY *= transform.scaleY;
    maxWeight = Math.max(maxWeight, transform.weight);
  }

  // convergeFactor is 1 because convergence is already applied per-modifier via effectiveWeight.
  // The dominantBlendMode is kept for informational purposes and for the outer
  // combineTransformsComponentLevel to choose the right combination strategy.
  return { translateX, translateY, rotation, scaleX, scaleY, weight: maxWeight, blendMode: dominantBlendMode, convergeFactor: 1 };
}

// ============================================================
// M5: Animation Modifier Velocity Computation
// ============================================================

// P3-2: Cache the last computed animation transform for velocity computation.
// Avoids calling computeAnimationModifierTransform twice per modifier per frame.
const _lastAnimTransform = new Map<string, {
  frame: number;
  translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number;
}>();

/**
 * Compute the velocity (delta transform per frame) of part-level animation modifiers.
 * Used to feed velocity into the motion blur system.
 * Returns the difference in transform between currentFrame and currentFrame-1.
 *
 * P3-2: Uses cached previous-frame transform from computePartAnimationTransform
 * instead of independently evaluating each modifier at currentFrame-1.
 */
export function computeAnimModifierVelocity(
  animModifiers: PartAnimationModifier[],
  currentFrame: number,
  frameRate: number = 12,
): { vx: number; vy: number; vRotation: number; vScaleX: number; vScaleY: number } {
  if (currentFrame <= 0 || animModifiers.length === 0) {
    return { vx: 0, vy: 0, vRotation: 0, vScaleX: 0, vScaleY: 0 };
  }

  // Filter to only enabled modifiers for a minor optimization
  const enabledModifiers = animModifiers.filter(m => m.enabled);
  if (enabledModifiers.length === 0) {
    return { vx: 0, vy: 0, vRotation: 0, vScaleX: 0, vScaleY: 0 };
  }

  // P3-2: Use cached previous-frame transform instead of recomputing.
  // Build a composite key from all enabled modifier IDs.
  const cacheKey = enabledModifiers.map(m => m.id).sort().join(',');
  const prev = _lastAnimTransform.get(cacheKey);

  // Compute current frame transform using the lightweight deterministic path
  // (same as before, but only once — not for the previous frame)
  let curTX = 0, curTY = 0, curRot = 0, curSX = 1, curSY = 1;
  for (const rawMod of enabledModifiers) {
    // M7: Resolve paramKeyframes/paramDrivers for velocity computation
    const mod = resolveAnimModifierParams(rawMod, currentFrame);
    const tCur = computeAnimationModifierTransform(mod, currentFrame, frameRate);
    curTX += tCur.translateX;
    curTY += tCur.translateY;
    curRot += tCur.rotation;
    curSX *= tCur.scaleX;
    curSY *= tCur.scaleY;
  }

  // Cache current transform for next frame's velocity computation
  _lastAnimTransform.set(cacheKey, {
    frame: currentFrame,
    translateX: curTX, translateY: curTY, rotation: curRot, scaleX: curSX, scaleY: curSY,
  });

  // Use cached previous frame if available and sequential
  if (prev && prev.frame === currentFrame - 1) {
    return {
      vx: curTX - prev.translateX,
      vy: curTY - prev.translateY,
      vRotation: curRot - prev.rotation,
      vScaleX: curSX - prev.scaleX,
      vScaleY: curSY - prev.scaleY,
    };
  }

  // Fallback: compute previous frame transform (only on seek/frame jump)
  let prevTX = 0, prevTY = 0, prevRot = 0, prevSX = 1, prevSY = 1;
  for (const mod of enabledModifiers) {
    const tPrev = computeAnimationModifierTransform(mod, currentFrame - 1, frameRate);
    prevTX += tPrev.translateX;
    prevTY += tPrev.translateY;
    prevRot += tPrev.rotation;
    prevSX *= tPrev.scaleX;
    prevSY *= tPrev.scaleY;
  }
  return {
    vx: curTX - prevTX,
    vy: curTY - prevTY,
    vRotation: curRot - prevRot,
    vScaleX: curSX - prevSX,
    vScaleY: curSY - prevSY,
  };
}

// ============================================================
// V12: Global Modifier Transform Computation
// ============================================================

/**
 * Compute the combined transform from all active global modifiers.
 * Global modifiers are applied AFTER per-part animation modifiers,
 * providing a "camera" or "world" transform that affects all parts equally.
 *
 * The transform is computed as an additive offset on top of the per-part
 * combined transform (translate additive, rotate additive, scale multiplicative).
 */
export function computeGlobalModifierTransform(
  globalModifiers: GlobalModifier[],
  currentFrame: number,
  frameRate: number = 12,
): { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number } {
  let translateX = 0;
  let translateY = 0;
  let rotation = 0;
  let scaleX = 1;
  let scaleY = 1;

  for (const mod of globalModifiers) {
    if (!mod.enabled) continue;

    // Compute weight from effective range
    const weight = computeModifierWeight(mod, currentFrame);
    if (weight <= 0) continue;

    // Dispatch to the handler for this modifier type
    const handler = GLOBAL_TRANSFORM_HANDLERS[mod.type];
    if (handler) {
      const ctx: GlobalTransformContext = { currentFrame, frameRate, weight };
      const partial = handler(mod, ctx);
      // Accumulate: additive for translate/rotate, multiplicative for scale
      if (partial.translateX !== undefined) translateX += partial.translateX;
      if (partial.translateY !== undefined) translateY += partial.translateY;
      if (partial.rotation !== undefined) rotation += partial.rotation;
      if (partial.scaleX !== undefined) scaleX *= partial.scaleX;
      if (partial.scaleY !== undefined) scaleY *= partial.scaleY;
    }
  }

  return { translateX, translateY, rotation, scaleX, scaleY };
}
