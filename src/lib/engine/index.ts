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
  validateVariableGraph,
  bakeParamDriverToKeyframes,
} from './param-driver';

// Interpolation
export { interpolateModifiers } from './interpolation';

// Skeleton
export { computeBoneTransforms } from './skeleton';

// Frame cache
export {
  markPartDirty,
  invalidateAnimModifierCache,
} from './frame-cache';

// Brush/stroke rendering
export { renderMotionBlurStroke, renderEffectStroke } from './brush-render';

// Render pipeline
export {
  createPartCanvas,
  renderPartEditMode,
  renderFrame,
  renderFrameToCanvas,
  renderPuppetNodes,
} from './render-pipeline';

// Utilities
export { imageDataToPixelGrid, floodFill } from './utils';
