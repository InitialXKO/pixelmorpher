// ============================================================
// PixelMorpher - Engine Module Barrel
// Re-exports public API consumed outside the engine directory
// ============================================================

// Pixel modifiers
export {
  applyPixelModifiers,
} from './pixel-modifiers';

// Animation state (from animation-state.ts)
export {
  getAnimationFrameAndWeight,
  computeKeyframeBaseTransform,
  combineTransformsComponentLevel,
  getWheelSegmentAtFrame,
  getGaitPhaseAtFrame,
} from './animation-state';

// Animation dispatch (from animation-dispatch.ts — separated to break circular deps)
export {
  computeAnimationModifierTransform,
  computePartAnimationTransform,
  computeAnimModifierVelocity,
  computeGlobalModifierTransform,
} from './animation-dispatch';

// Param driver
export {
  invalidateVariableContextCache,
  invalidatePhaseCache,
  invalidateParamDriverEvalCache,
  validateVariableGraph,
  bakeParamDriverToKeyframes,
} from './param-driver';

// Interpolation
export { interpolateModifiers, invalidateInterpolationCache } from './interpolation';

// Skeleton
export { computeBoneTransforms } from './skeleton';

// Frame cache
export {
  markPartDirty,
  invalidateAnimModifierCache,
} from './frame-cache';

// Brush/stroke rendering
export { renderMotionBlurStroke, renderEffectStroke } from './brush-render';


// Puppet utils (moved from puppet-render.ts, now deleted)
export { renderPixelPerfectRotation, resolvePuppetNodeSprite } from './puppet-utils';

// Utilities
export { imageDataToPixelGrid, floodFill } from './utils';
