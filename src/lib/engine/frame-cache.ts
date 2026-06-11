// ============================================================
// PixelMorpher - Frame Cache & Dirty Flags
// getCachedFrame, setCachedFrame, markPartDirty, isPartDirty, markPartClean,
// clearAnimationStateCache, invalidateAnimModifierCache, cache infrastructure
// ============================================================

import type {
  Keyframe,
  ModifierParamValue,
  AnimationModifierState,
  GaitPhase,
} from '../types';
import { getPartPixelCache } from './canvas-pool';

// B7: Persistent frame cache for onion skin and playback
const _frameRenderCache = new Map<number, { canvas: HTMLCanvasElement; keyframeHash: string }>();
const _FRAME_CACHE_MAX = 64;
let _frameCacheKeyframeHash: string = '';

// B8: Part canvas dirty flag system
const _partDirtyFlags = new Map<string, boolean>();
let _partDirtyKeyframesRef: Keyframe[] | null = null;

// B3: Keyframe index cache
let _kfByPartCache: { keyframesRef: Keyframe[] | null; map: Map<string, Keyframe[]> } = {
  keyframesRef: null,
  map: new Map(),
};

// B4: Modifier resolution LRU cache
const _modifierResolveCache = new Map<string, Keyframe>();
const _MODIFIER_RESOLVE_CACHE_MAX = 512; // Increased from 256 for better playback cache hit rate
let _modifierResolveCacheKeyframesRef: Keyframe[] | null = null;

// P4-4: Cache for allActiveDrivers in renderFrame
const _activeDriversCache: { keyframes: Keyframe[] | null; drivers: import('../types').ParamDriver[] } = {
  keyframes: null,
  drivers: [],
};

// Animation state cache
interface AnimationModifierCacheEntry {
  current: AnimationModifierState;
  checkpoints: Array<{
    frame: number;
    phase: number;
    angularVelocity: number;
    paramsHash: number;
    wheelAngle?: number;
    wheelOmega?: number;
    wheelAccelActive?: boolean;
    gaitPhase?: GaitPhase;
    gaitPhaseStartFrame?: number;
  }>;
}

const _animStateCache = new Map<string, AnimationModifierCacheEntry>();

// Hash infrastructure
const _hashCache = new WeakMap<object, number>();
const CHECKPOINT_INTERVAL = 10;

function hashParams(params: Record<string, ModifierParamValue>): number {
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

/** Clear the animation state cache (call when project changes significantly) */
function clearAnimationStateCache() {
  _animStateCache.clear();
  // P5-1: Also clear pixel cache when animation state is reset
  getPartPixelCache().clear();
  // B3+B4+B7+B8: Clear all render caches
  _kfByPartCache = { keyframesRef: null, map: new Map() };
  _modifierResolveCache.clear();
  _modifierResolveCacheKeyframesRef = null;
  _frameRenderCache.clear();
  _partDirtyFlags.clear();
  _partDirtyKeyframesRef = null;
  // P8: Also clear ParamDriver evaluation cache when project changes
  try {
    // Dynamic import to avoid circular dependency
    const { invalidateParamDriverEvalCache } = require('./param-driver');
    invalidateParamDriverEvalCache();
  } catch { /* ignore if module not yet loaded */ }
}
export function getKfByPart(keyframes: Keyframe[]): Map<string, Keyframe[]> {
  if (_kfByPartCache.keyframesRef === keyframes) {
    return _kfByPartCache.map;
  }
  // Rebuild index
  const kfByPart = new Map<string, Keyframe[]>();
  for (const kf of keyframes) {
    let arr = kfByPart.get(kf.partId);
    if (!arr) { arr = []; kfByPart.set(kf.partId, arr); }
    arr.push(kf);
  }
  for (const arr of kfByPart.values()) {
    if (arr.length > 1 && arr.some((k, i) => i > 0 && k.frame < arr[i - 1].frame)) {
      arr.sort((a, b) => a.frame - b.frame);
    }
  }
  _kfByPartCache = { keyframesRef: keyframes, map: kfByPart };
  return kfByPart;
}

/** B7: Compute a lightweight hash of keyframe data for cache invalidation */
function computeKeyframeHash(keyframes: Keyframe[]): string {
  let hash = '';
  for (const kf of keyframes) {
    hash += `${kf.id}:${kf.frame}:${kf.modifiers.length}:`;
  }
  return hash;
}

/** B7: Get a cached rendered frame, or null if not cached/stale */
export function getCachedFrame(frame: number, keyframes: Keyframe[]): HTMLCanvasElement | null {
  const hash = computeKeyframeHash(keyframes);
  const cached = _frameRenderCache.get(frame);
  if (cached && cached.keyframeHash === hash) {
    return cached.canvas;
  }
  return null;
}

/** B7: Store a rendered frame in the persistent cache */
export function setCachedFrame(frame: number, canvas: HTMLCanvasElement, keyframes: Keyframe[]): void {
  const hash = computeKeyframeHash(keyframes);
  // Evict oldest entries if cache is full
  if (_frameRenderCache.size >= _FRAME_CACHE_MAX) {
    const firstKey = _frameRenderCache.keys().next().value;
    if (firstKey !== undefined) _frameRenderCache.delete(firstKey);
  }
  _frameRenderCache.set(frame, { canvas, keyframeHash: hash });
}
/** B8: Mark a part as dirty (needs canvas rebuild) */
export function markPartDirty(partId: string): void {
  // Mark all frame entries for this part as dirty
  for (const key of _partDirtyFlags.keys()) {
    if (key.startsWith(partId + ':')) {
      _partDirtyFlags.set(key, true);
    }
  }
}

/** B8: Check if a part:frame combination is dirty */
function isPartDirty(partId: string, frame: number): boolean {
  const key = `${partId}:${frame}`;
  const dirty = _partDirtyFlags.get(key);
  // If not tracked, assume dirty (first render)
  return dirty === undefined || dirty;
}

/** B8: Mark a part:frame as clean after rendering */
function markPartClean(partId: string, frame: number): void {
  _partDirtyFlags.set(`${partId}:${frame}`, false);
}
/**
 * Invalidate the cache for a specific animation modifier.
 * Call when a parameter (especially period/phase) changes so the next
 * render recomputes the phase from scratch rather than incrementally.
 */
export function invalidateAnimModifierCache(modifierId: string) {
  const entry = _animStateCache.get(modifierId);
  if (entry) {
    // Clear checkpoints but keep current state so next render can
    // decide whether to recompute from scratch or use checkpoints
    entry.checkpoints = [];
  } else {
    _animStateCache.delete(modifierId);
  }
}

// Export cache accessors for other modules
export function getAnimStateCache() { return _animStateCache; }
export function getActiveDriversCache() { return _activeDriversCache; }
export function getKfByPartCache() { return _kfByPartCache; }
export function setKfByPartCache(val: typeof _kfByPartCache) { _kfByPartCache = val; }
export function getModifierResolveCache() { return { cache: _modifierResolveCache, max: _MODIFIER_RESOLVE_CACHE_MAX, keyframesRef: _modifierResolveCacheKeyframesRef }; }
export function setModifierResolveCacheKeyframesRef(ref: Keyframe[] | null) { _modifierResolveCacheKeyframesRef = ref; }
export function getModifierResolveCacheKeyframesRef() { return _modifierResolveCacheKeyframesRef; }
export function getModifierResolveCacheMap() { return _modifierResolveCache; }
export function getFrameRenderCache() { return _frameRenderCache; }
export function getFrameCacheMax() { return _FRAME_CACHE_MAX; }
export function getDirtyFlags() { return { flags: _partDirtyFlags, keyframesRef: _partDirtyKeyframesRef }; }
export function setDirtyKeyframesRef(ref: Keyframe[] | null) { _partDirtyKeyframesRef = ref; }
export function getDirtyFlagsMap() { return _partDirtyFlags; }
export function getHashParams() { return hashParams; }
export function getCheckpointInterval() { return CHECKPOINT_INTERVAL; }
