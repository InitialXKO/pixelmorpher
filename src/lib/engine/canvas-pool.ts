// ============================================================
// PixelMorpher - Canvas Pool
// acquireCanvas, releaseCanvas, clearPartPixelCache,
// _partPixelCache, canCachePartPixels
// ============================================================

import type {
  Keyframe,
  ModifierInstance,
  ModifierType,
  PixelGrid,
} from '../types';
import { isPixelDeformModifier } from './modifier-types';

// ============================================================
// P0: Canvas Pool — reuse offscreen canvases instead of allocating per frame
// ============================================================
const _canvasPool: HTMLCanvasElement[] = [];
const _canvasPoolMaxSize = 128; // Increased from 32 to reduce alloc/free churn during playback

export function acquireCanvas(w: number, h: number): HTMLCanvasElement {
  // Guard: 0 尺寸 canvas 会导致 drawImage 抛 InvalidStateError
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  const c = _canvasPool.pop();
  if (c) {
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    } else {
      // 同尺寸复用必须清空，否则残留上次的像素（曾导致同精灵对称角度时重影）
      c.getContext('2d')!.clearRect(0, 0, cw, ch);
    }
    // 重置 transform，防止复用的 canvas 残留翻转/旋转
    c.getContext('2d')!.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }
  const nc = document.createElement('canvas');
  nc.width = cw;
  nc.height = ch;
  return nc;
}

export function releaseCanvas(c: HTMLCanvasElement) {
  if (_canvasPool.length < _canvasPoolMaxSize) {
    _canvasPool.push(c);
  }
}

// ============================================================
// P5-1: Part pixel canvas cache — skip ImageData rebuild when pixels unchanged
// For parts without pixel-level modifiers or deformation animations,
// the pixel→canvas conversion is the same every frame. Cache it.
// ============================================================
const _partPixelCache = new Map<string, {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pixelsRef: PixelGrid;   // identity check — same reference = same pixels
  keyframeId: string;     // which keyframe's correctionMask was used
}>();

// LRU limit for part pixel cache to prevent unbounded memory growth
const _PART_PIXEL_CACHE_MAX = 256;

/** Clear the part pixel cache (call when project data changes significantly) */
function clearPartPixelCache() {
  _partPixelCache.clear();
}

/** Get the pixel cache map (used by render-pipeline) */
export function getPartPixelCache() {
  return _partPixelCache;
}

/**
 * Check if a part's pixel data can be cached and reused across frames.
 * Returns true when:
 * - No pixel-level edit modifiers are active
 * - No pixel-level animation deformation modifiers are active
 * - No correctionMask override on the keyframe
 * - No keyframe pixel modifiers (outline, dither, etc.)
 *
 * In this common case, the pixel→ImageData→canvas conversion is identical
 * every frame, so we can cache it and skip the expensive rebuild.
 */
export function canCachePartPixels(
  keyframe: Keyframe | null,
  applyPixelMods: boolean,
  resolvedEditModifiers?: ModifierInstance[],
): boolean {
  // correctionMask overrides base pixels — can't cache since it varies per keyframe
  if (keyframe?.correctionMask) return false;

  // Check part edit modifiers for pixel-modifying types
  const editMods = resolvedEditModifiers ?? ([] as import("../types").ModifierInstance[]);
  if (editMods && editMods.length > 0) {
    const pixelModTypes: ModifierType[] = [
      'color_replace', 'outline', 'dither', 'pixel_displace',
      'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
    ];
    for (const m of editMods) {
      if (m.enabled && pixelModTypes.includes(m.type)) return false;
    }
    // Translate shift also changes pixel grid layout
    const translateMod = editMods.find(m => m.type === 'translate' && m.enabled);
    if (translateMod) {
      const dx = Math.round(Number(translateMod.params.offsetX) || 0);
      const dy = Math.round(Number(translateMod.params.offsetY) || 0);
      if (dx !== 0 || dy !== 0) return false;
    }
  }

  // Check keyframe pixel modifiers
  if (applyPixelMods && keyframe && !keyframe.isBaked) {
    const pixelModTypes: ModifierType[] = [
      'color_replace', 'outline', 'dither', 'pixel_displace',
      'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
    ];
    for (const m of keyframe.modifiers) {
      if (!m.collapsed && m.enabled && pixelModTypes.includes(m.type)) return false;
    }
  }

  // Check animation deformation modifiers
  if (false) { // Part 无 animationModifiers
    for (const am of ([] as import("../types").PartAnimationModifier[])) {
      if (am.enabled && isPixelDeformModifier(am.type)) return false;
    }
  }

  return true;
}
