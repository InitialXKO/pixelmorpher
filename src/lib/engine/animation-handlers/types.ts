// ============================================================
// PixelMorpher - Animation Handler Types
// Shared type definitions for the lookup-table / strategy pattern
// used to dispatch animation modifier transforms.
// ============================================================

import type { ModifierInstance, PartAnimationModifier, GlobalModifier } from '../../types';

// ============================================================
// Shared result types
// ============================================================

/** The geometric transform produced by any animation modifier. */
export interface TransformResult {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** Default (identity) transform result. */
const DEFAULT_TRANSFORM: TransformResult = {
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

// ============================================================
// Bake transform (deterministic, for bake-to-timeline)
// ============================================================

/** Context provided to every bake transform handler. */
export interface BakeTransformContext {
  relativeFrame: number;
  weight: number;
  effectiveWeight: number;
  frameRate: number;
  /** Original global frame number (needed by wheel handler for computeWheelAngularStateDeterministic) */
  currentFrame: number;
}

/**
 * Handler signature for a single modifier type in the deterministic
 * bake-to-timeline path.  Receives the modifier and a pre-computed
 * context; returns a *partial* transform that will be merged into
 * the base identity result.
 */
export type BakeTransformHandler = (
  mod: ModifierInstance | PartAnimationModifier,
  ctx: BakeTransformContext,
) => Partial<TransformResult>;

// ============================================================
// Realtime transform (uses phase cache)
// ============================================================

/** Context provided to every realtime transform handler. */
export interface RealtimeTransformContext {
  relativeFrame: number;
  weight: number;
  effectiveWeight: number;
  convergeFactor: number;
  frameRate: number;
  currentFrame: number;
}

/** Extended result for realtime transforms (includes weight & convergeFactor). */
export interface RealtimeTransformResult extends TransformResult {
  weight: number;
  convergeFactor: number;
}

/** Default realtime result. */
export const DEFAULT_REALTIME_RESULT: RealtimeTransformResult = {
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  weight: 0,
  convergeFactor: 1,
};

/**
 * Handler signature for a single modifier type in the realtime
 * rendering path.  May return `null` to signal "no output"
 * (e.g. weight <= 0), which the dispatcher will translate to the
 * default zero-weight result.
 */
export type RealtimeTransformHandler = (
  mod: ModifierInstance | PartAnimationModifier,
  ctx: RealtimeTransformContext,
) => Partial<RealtimeTransformResult> | null;

// ============================================================
// Global modifier transform
// ============================================================

/** Context provided to every global transform handler. */
export interface GlobalTransformContext {
  currentFrame: number;
  frameRate: number;
  weight: number;
}

/**
 * Handler signature for a single global modifier type.
 * Returns a *partial* transform that will be accumulated
 * (additive translate/rotate, multiplicative scale) by the caller.
 */
export type GlobalTransformHandler = (
  mod: GlobalModifier,
  ctx: GlobalTransformContext,
) => Partial<TransformResult>;
