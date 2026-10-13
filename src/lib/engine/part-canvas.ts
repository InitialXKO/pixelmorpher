// ============================================================
// PixelMorpher - Part Canvas Utilities
// Moved from render-pipeline.ts (deleted) — used by modifier-slice baking
// ============================================================

import type {
  Keyframe, ModifierInstance, PartAnimationModifier, PixelGrid,
} from '../types';
import type { Sprite } from '../unified-types';
import { acquireCanvas, canCachePartPixels, getPartPixelCache } from './canvas-pool';
import { applyPixelModifiers } from './pixel-modifiers';
import { applyPixelDeformAnimations } from './render-helpers/pixel-deform-animations';
import { resolveKeyframeModifierParams } from './param-driver';
import { computePartBasePixels } from './render-helpers/part-base-resolver';
import { renderPixelGridToCanvas } from './render-helpers/pixel-grid-renderer';

export interface PartCanvasResult {
  canvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
}

export function createPartCanvas(
  id: string,
  sprite: Sprite,
  keyframe: Keyframe | null,
  applyPixelMods: boolean = false,
  currentFrame: number = 0,
  frameRate: number = 12,
  /** World-space offset for the part — used by wave_deform when coordinateSystem='world' */
  worldOffsetX: number = 0,
  worldOffsetY: number = 0,
  /** V4.1: Pre-resolved part edit modifiers (from resolvePartEditModifiers).
   *  When provided, overrides [] in the rendering pipeline.
   *  This allows frame-accurate part keyframe resolution without coupling engine to store. */
  resolvedEditModifiers?: ModifierInstance[],
  /** 木偶节点的像素层动画修改器（Part 不再自带，由调用方传入） */
  overrideAnimModifiers?: PartAnimationModifier[],
): PartCanvasResult {
  // P5-1: Try pixel canvas cache — skip expensive ImageData rebuild when pixels unchanged.
  // This is the single biggest optimization for playback: for parts without pixel-level
  // modifiers or deformation animations, the pixel→canvas conversion is identical every frame.
  if (canCachePartPixels(keyframe, applyPixelMods, resolvedEditModifiers)) {
    // Frame-level cache key: partId:keyframeId — different keyframes may have different
    // correctionMask/pixel data, so we must cache per-keyframe, not just per-part.
    // This reduces putImageData calls by 50-70% during playback.
    const kfId = keyframe?.id ?? '_default';
    const cacheKey = `${id}:${kfId}`;
    const pixelCache = getPartPixelCache();
    const cached = pixelCache.get(cacheKey);
    // Cache hit: same pixels reference, same dimensions
    if (cached && cached.pixelsRef === sprite.data && cached.width === sprite.width && cached.height === sprite.height) {
      // Return a fresh pool canvas with the cached content drawn onto it
      // (We can't return the cached canvas itself since the caller may apply effects to it)
      const resultCanvas = acquireCanvas(cached.width, cached.height);
      const resultCtx = resultCanvas.getContext('2d')!;
      resultCtx.clearRect(0, 0, cached.width, cached.height);
      resultCtx.drawImage(cached.canvas, 0, 0);
      return { canvas: resultCanvas, offsetX: cached.offsetX, offsetY: cached.offsetY };
    }
    // Cache miss: build and cache
    const result = createPartCanvasInner(id, sprite, keyframe, applyPixelMods, currentFrame, frameRate, worldOffsetX, worldOffsetY, resolvedEditModifiers, overrideAnimModifiers);
    // Store a dedicated cache canvas (not from pool — pool canvases get recycled)
    const cacheCanvas = document.createElement('canvas');
    cacheCanvas.width = result.canvas.width;
    cacheCanvas.height = result.canvas.height;
    const cacheCtx = cacheCanvas.getContext('2d')!;
    cacheCtx.drawImage(result.canvas, 0, 0);
    // LRU eviction: limit cache size to prevent unbounded memory growth
    if (pixelCache.size >= 256) {
      const firstKey = pixelCache.keys().next().value;
      if (firstKey !== undefined) pixelCache.delete(firstKey);
    }
    pixelCache.set(cacheKey, {
      canvas: cacheCanvas,
      width: sprite.width,
      height: sprite.height,
      offsetX: result.offsetX,
      offsetY: result.offsetY,
      pixelsRef: sprite.data,
      keyframeId: kfId,
    });
    return result;
  }

  // Uncacheable path — always rebuild
  return createPartCanvasInner(id, sprite, keyframe, applyPixelMods, currentFrame, frameRate, worldOffsetX, worldOffsetY, resolvedEditModifiers, overrideAnimModifiers);
}

/** Inner implementation of createPartCanvas — the actual pixel→canvas conversion */
function createPartCanvasInner(
  id: string,
  sprite: Sprite,
  keyframe: Keyframe | null,
  applyPixelMods: boolean = false,
  currentFrame: number = 0,
  frameRate: number = 12,
  worldOffsetX: number = 0,
  worldOffsetY: number = 0,
  resolvedEditModifiers?: ModifierInstance[],
  overrideAnimModifiers?: PartAnimationModifier[],
): PartCanvasResult {
  const effectiveWidth = keyframe?.overrideWidth ?? sprite.width;
  const effectiveHeight = keyframe?.overrideHeight ?? sprite.height;

  // Step 1: Compute effective part base pixels (edit modifiers applied)
  const baseResult = computePartBasePixels(sprite.data, keyframe, currentFrame, resolvedEditModifiers);

  // Step 2: Determine base pixels (correctionMask overrides if present)
  let pixels: PixelGrid;
  let modOffsetX = 0;
  let modOffsetY = 0;

  const basePixels = keyframe?.correctionMask ?? baseResult.partBasePixels;
  const baseIsUnique = keyframe?.correctionMask ? true : baseResult.partBaseIsUnique;
  // If part edit modifiers expanded the grid, account for the offset
  // (unless correctionMask overrides the base entirely)
  if (!keyframe?.correctionMask) {
    modOffsetX = baseResult.partBaseOffsetX;
    modOffsetY = baseResult.partBaseOffsetY;
  }

  // Step 3: Apply keyframe pixel modifiers
  if (applyPixelMods && keyframe && !keyframe.isBaked) {
    const rawMods = keyframe.modifiers.filter(m => !m.collapsed);
    // M7+: Resolve paramKeyframes and paramDrivers for keyframe modifiers
    // (same as part_edit path — ensures ParamDriver-driven params take effect)
    const activeMods = rawMods.some(m =>
      (m.paramKeyframes && m.paramKeyframes.length > 0) ||
      (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some(d => d.enabled && !d.isBaked))
    ) ? resolveKeyframeModifierParams(rawMods, currentFrame) : rawMods;
    const modResult = applyPixelModifiers(basePixels ?? sprite.data, activeMods, currentFrame);
    pixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  } else {
    // P1-2: No keyframe pixel modifiers — reference basePixels directly instead of copying
    pixels = basePixels;
    void baseIsUnique; // preserved for future optimization
  }

  // Step 4: Apply pixel-level deformation animation modifiers
  // (Part 不再自带 animationModifiers；木偶节点通过 overrideModifiers 传入)
  if (applyPixelMods) {
    const deformResult = applyPixelDeformAnimations(
      sprite.width, sprite.height, keyframe, pixels, currentFrame, frameRate,
      worldOffsetX, worldOffsetY, modOffsetX, modOffsetY,
      overrideAnimModifiers ?? [],
    );
    pixels = deformResult.pixels;
    modOffsetX = deformResult.modOffsetX;
    modOffsetY = deformResult.modOffsetY;
  }

  // Step 5: Render pixels to canvas via ImageData
  const canvas = renderPixelGridToCanvas(pixels, effectiveWidth, effectiveHeight);

  return { canvas, offsetX: modOffsetX, offsetY: modOffsetY };
}
