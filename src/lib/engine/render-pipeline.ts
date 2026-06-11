// ============================================================
// PixelMorpher - Render Pipeline
// renderPartToCanvas, createPartCanvas, renderPartEditMode,
// renderFrame, renderOnionSkin, renderFrameToCanvas
// ============================================================

import type {
  Part,
  Keyframe,
  ModifierInstance,
  ModifierType,
  PixelGrid,
  AnimationBlendMode,
  Bone,
  Skeleton,
  ProceduralAnimation,
  MotionBlurStroke,
  EffectStroke,
  EffectTrack,
  CanvasModifierTrack,
  AnimationVariable,
  ModifierParamValue,
  ParamDriver,
  GlobalModifier,
  PuppetSkeleton,
  PuppetCharacter,
  PuppetNodeKeyframe,
  PuppetDirection,
} from '../types';
import { computeDirectionDrawOrder } from '../store/puppet-slice';
import { renderPixelPerfectRotation, shouldMirrorDirection } from './puppet-render';
import { hexToRgbCached } from './color-utils';
import { acquireCanvas, releaseCanvas, canCachePartPixels, getPartPixelCache } from './canvas-pool';
import { applyPixelModifiers } from './pixel-modifiers';
import { computeKeyframeBaseTransform, combineTransformsComponentLevel } from './animation-state';
import { computePartAnimationTransform, computeAnimModifierVelocity, computeGlobalModifierTransform } from './animation-dispatch';
import { resolveKeyframeModifierParams, buildVariableContext, collectActiveParamDrivers, VariableContext, EMPTY_VARIABLE_CONTEXT, cachedVariableContext, cachedVariableContextFrame, cachedVariableContextHash, setCachedVariableContext } from './param-driver';
import { interpolateModifiers } from './interpolation';
import { computeBoneTransforms, applyProceduralAnimations } from './skeleton';
import { getCachedFrame, setCachedFrame, getKfByPart, getActiveDriversCache, getModifierResolveCacheMap, getModifierResolveCacheKeyframesRef, setModifierResolveCacheKeyframesRef, getFrameRenderCache, getFrameCacheMax, getDirtyFlagsMap, setDirtyKeyframesRef, getKfByPartCache, setKfByPartCache } from './frame-cache';
import { renderMotionBlurStroke, renderEffectStroke, applyAutoMotionBlur } from './brush-render';
import { getTranslateOffset, computePhysicsOffset, renderGlowEffect, renderParticleEffect, renderAfterimageEffect, renderMotionBlurEffect, renderEffectTrackFrame } from './effect-render';
import { applyCanvasModifiers } from './canvas-modifiers';
import { perfTrack } from './perf-monitor';
import { computePartBasePixels } from './render-helpers/part-base-resolver';
import { applyPixelDeformAnimations } from './render-helpers/pixel-deform-animations';
import { renderPixelGridToCanvas } from './render-helpers/pixel-grid-renderer';
import { interpolateNodeKeyframes } from './render-helpers/puppet-keyframe-interpolation';
import { resolveSpriteParts } from './render-helpers/puppet-sprite-resolver';
import { computePuppetWorldTransforms } from './render-helpers/puppet-world-transforms';
import { renderJointDiscs } from './render-helpers/puppet-joint-discs';
import type { InterpolatedNodeValues, WorldTransform } from './render-helpers/types';

// ============================================================
// P6: partBoneBindings WeakMap cache — avoid rebuilding Map every frame
// The bone binding structure only changes when skeletons change (new reference),
// so we cache the computed Map keyed by the skeletons array reference.
// ============================================================
const _partBoneBindingsCache: {
  skeletonsRef: Skeleton[] | null;
  bindings: Map<string, Array<{ skeletonId: string; bone: Bone; weight: number }>>;
} = { skeletonsRef: null, bindings: new Map() };

// ============================================================
// Core Rendering Functions
// ============================================================

/**
 * Render a pixel grid to an offscreen canvas, then apply modifiers
 * and composite onto the main canvas.
 */
function renderPartToCanvas(
  ctx: CanvasRenderingContext2D,
  part: Part,
  keyframe: Keyframe | null,
  offsetX: number = 0,
  offsetY: number = 0,
  currentFrame: number = 0,
  autoMotionBlur: boolean = false,
  autoMotionBlurIntensity: number = 0.5,
  allKeyframes: Keyframe[] = [],
  frameRate: number = 12,
  previewQuality: 'low' | 'medium' | 'high' = 'high',
  /** V4.1: Pre-resolved part edit modifiers for frame-accurate rendering */
  resolvedEditModifiers?: ModifierInstance[],
) {
  if (!part.visible) return;

  const allModifiers = keyframe && !keyframe.isBaked ? keyframe.modifiers : [];
  // Skip collapsed modifiers — their effect is already baked into correctionMask
  const modifiers = allModifiers.filter(m => !m.collapsed);

  // Compute physics offset before canvas transforms
  const physicsOffset = computePhysicsOffset(modifiers, currentFrame);

  ctx.save();

  // V3.1: Component-level blending pipeline
  // 1. Compute keyframe base transform (non-animation modifiers only)
  const kfBase = computeKeyframeBaseTransform(modifiers);

  // 2. Compute animation transform from part-level animation modifiers
  const animTransform = computePartAnimationTransform(part.animationModifiers || [], currentFrame, frameRate);

  // 2.5 V13: Compute part-level global modifier transform (always-on modifiers for this part)
  const partGlobalTransform = (part.globalModifiers && part.globalModifiers.length > 0)
    ? computeGlobalModifierTransform(part.globalModifiers, currentFrame, frameRate)
    : { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };

  // 3. Combine using component-level blending (V3.2: with blend mode support)
  let combined = combineTransformsComponentLevel(kfBase, animTransform, animTransform.blendMode, animTransform.convergeFactor);

  // 3.5 V13: Apply part-level global modifier transform on top of combined.
  // Part global modifiers are additive (translate/rotate) / multiplicative (scale),
  // applied AFTER the keyframe+animation blend so they always affect the part.
  combined = {
    translateX: combined.translateX + partGlobalTransform.translateX,
    translateY: combined.translateY + partGlobalTransform.translateY,
    rotation: combined.rotation + partGlobalTransform.rotation,
    scaleX: combined.scaleX * partGlobalTransform.scaleX,
    scaleY: combined.scaleY * partGlobalTransform.scaleY,
  };

  // 4. Apply combined transform to canvas
  // Correct pivot-aware transform order:
  //   translate(offset) → translate(kf) → [rotate/scale happen around pivot] → translate(-pivot) → draw
  // This ensures rotation and scaling are centered on the pivot point.
  ctx.translate(offsetX + (part.offsetX || 0), offsetY + (part.offsetY || 0));
  ctx.translate(combined.translateX, combined.translateY);
  ctx.rotate((combined.rotation * Math.PI) / 180);
  ctx.scale(combined.scaleX, combined.scaleY);

  // Apply skews (not part of component blending, applied separately)
  for (const { skewX, skewY } of kfBase.skews) {
    ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
  }

  // Apply physics offset as additional translate
  if (physicsOffset.x !== 0 || physicsOffset.y !== 0) {
    ctx.translate(physicsOffset.x, physicsOffset.y);
  }

  // Use keyframe dimension overrides when available (e.g. after geometric bake)
  const effectivePivotX = keyframe?.overridePivotX ?? part.pivotX;
  const effectivePivotY = keyframe?.overridePivotY ?? part.pivotY;

  // Compute world-space offset for pixel-level deformation modifiers
  // (wave_deform with coordinateSystem='world')
  // This is the approximate world position of the part's top-left corner,
  // ignoring rotation/scale (which don't affect wave phase in typical usage).
  const worldOffX = offsetX + (part.offsetX || 0) + combined.translateX - effectivePivotX + physicsOffset.x;
  const worldOffY = offsetY + (part.offsetY || 0) + combined.translateY - effectivePivotY + physicsOffset.y;

  // Create part canvas with pixel modifiers applied
  const partCanvasResult = perfTrack('createPartCanvas', () => createPartCanvas(part, keyframe, true, currentFrame, frameRate, worldOffX, worldOffY, resolvedEditModifiers));
  const partCanvas = partCanvasResult.canvas;

  // Adjust pivot by the pixel modifier overflow offset.
  // If pixel modifiers expanded the grid (e.g. outline), the origin shifted by (offsetX, offsetY),
  // so the pivot in the expanded canvas is (pivotX + offsetX, pivotY + offsetY).
  const adjustedPivotX = effectivePivotX + partCanvasResult.offsetX;
  const adjustedPivotY = effectivePivotY + partCanvasResult.offsetY;

  // Pivot offset: move origin to pivot point so rotation/scale above are pivot-centered
  // (The drawImage call already uses -pivotX,-pivotY, which combined with the
  // transform order above means rotation/scale happen around the pivot)
  ctx.translate(-adjustedPivotX, -adjustedPivotY);

  // === Render "behind" effects (before the part itself) ===
  // Preview quality: skip effect modifiers in low quality mode
  if (previewQuality !== 'low') {
    for (const mod of modifiers) {
      if (!mod.enabled) continue;
      switch (mod.type) {
        case 'glow':
          renderGlowEffect(ctx, part, mod, partCanvas);
          break;
        case 'afterimage':
          renderAfterimageEffect(ctx, part, mod, modifiers, partCanvas);
          break;
        case 'motion_blur':
          renderMotionBlurEffect(ctx, part, mod, modifiers, partCanvas);
          break;
      }
    }
  }

  // === Auto motion blur (if enabled) ===
  // M5: Compute animation modifier velocity and pass to auto motion blur
  if (autoMotionBlur && allKeyframes.length > 0) {
    const animVelocity = computeAnimModifierVelocity(part.animationModifiers || [], currentFrame, frameRate);
    // Only pass animVelocity if it has significant magnitude (avoid noise from near-zero)
    const hasAnimVelocity = Math.abs(animVelocity.vx) > 0.01 || Math.abs(animVelocity.vy) > 0.01;
    applyAutoMotionBlur(
      ctx, part, currentFrame, allKeyframes, autoMotionBlurIntensity, partCanvas,
      hasAnimVelocity ? { vx: animVelocity.vx, vy: animVelocity.vy } : undefined,
    );
  }

  // Render the part pixels
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(partCanvas, 0, 0);

  // P0-2: Return part canvas to pool after drawing
  releaseCanvas(partCanvas);

  // Note: keyframe.correctionMask is used as the base pixel data when the keyframe
  // has been "promoted to manual frame" (提升为手动帧). It replaces part.pixels as the
  // rendering base for this keyframe. This is handled in createPartCanvas() above.

  // === Render "on top" effects (after the part itself) ===
  // Preview quality: skip particle effects in low quality mode
  if (previewQuality !== 'low') {
    for (const mod of modifiers) {
      if (!mod.enabled) continue;
      switch (mod.type) {
        case 'particle':
          renderParticleEffect(ctx, part, mod, currentFrame);
          break;
      }
    }
  }

  ctx.restore();
}

/**
 * Create an offscreen canvas with the part's pixel data rendered on it.
 * Optionally applies pixel-level modifiers before rendering.
 */
export interface PartCanvasResult {
  canvas: HTMLCanvasElement;
  /** Pixel offset: how many pixels the canvas expanded to the left/top relative
   *  to the original part origin. Used to adjust the pivot point in rendering. */
  offsetX: number;
  offsetY: number;
}

export function createPartCanvas(
  part: Part,
  keyframe: Keyframe | null,
  applyPixelMods: boolean = false,
  currentFrame: number = 0,
  frameRate: number = 12,
  /** World-space offset for the part — used by wave_deform when coordinateSystem='world' */
  worldOffsetX: number = 0,
  worldOffsetY: number = 0,
  /** V4.1: Pre-resolved part edit modifiers (from resolvePartEditModifiers).
   *  When provided, overrides part.editModifiers in the rendering pipeline.
   *  This allows frame-accurate part keyframe resolution without coupling engine to store. */
  resolvedEditModifiers?: ModifierInstance[],
): PartCanvasResult {
  // P5-1: Try pixel canvas cache — skip expensive ImageData rebuild when pixels unchanged.
  // This is the single biggest optimization for playback: for parts without pixel-level
  // modifiers or deformation animations, the pixel→canvas conversion is identical every frame.
  if (canCachePartPixels(part, keyframe, applyPixelMods, resolvedEditModifiers)) {
    // Frame-level cache key: partId:keyframeId — different keyframes may have different
    // correctionMask/pixel data, so we must cache per-keyframe, not just per-part.
    // This reduces putImageData calls by 50-70% during playback.
    const kfId = keyframe?.id ?? '_default';
    const cacheKey = `${part.id}:${kfId}`;
    const pixelCache = getPartPixelCache();
    const cached = pixelCache.get(cacheKey);
    // Cache hit: same pixels reference, same dimensions
    if (cached && cached.pixelsRef === part.pixels && cached.width === part.width && cached.height === part.height) {
      // Return a fresh pool canvas with the cached content drawn onto it
      // (We can't return the cached canvas itself since the caller may apply effects to it)
      const resultCanvas = acquireCanvas(cached.width, cached.height);
      const resultCtx = resultCanvas.getContext('2d')!;
      resultCtx.clearRect(0, 0, cached.width, cached.height);
      resultCtx.drawImage(cached.canvas, 0, 0);
      return { canvas: resultCanvas, offsetX: cached.offsetX, offsetY: cached.offsetY };
    }
    // Cache miss: build and cache
    const result = createPartCanvasInner(part, keyframe, applyPixelMods, currentFrame, frameRate, worldOffsetX, worldOffsetY, resolvedEditModifiers);
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
      width: part.width,
      height: part.height,
      offsetX: result.offsetX,
      offsetY: result.offsetY,
      pixelsRef: part.pixels,
      keyframeId: kfId,
    });
    return result;
  }

  // Uncacheable path — always rebuild
  return createPartCanvasInner(part, keyframe, applyPixelMods, currentFrame, frameRate, worldOffsetX, worldOffsetY, resolvedEditModifiers);
}

/** Inner implementation of createPartCanvas — the actual pixel→canvas conversion */
function createPartCanvasInner(
  part: Part,
  keyframe: Keyframe | null,
  applyPixelMods: boolean = false,
  currentFrame: number = 0,
  frameRate: number = 12,
  worldOffsetX: number = 0,
  worldOffsetY: number = 0,
  resolvedEditModifiers?: ModifierInstance[],
): PartCanvasResult {
  const effectiveWidth = keyframe?.overrideWidth ?? part.width;
  const effectiveHeight = keyframe?.overrideHeight ?? part.height;

  // Step 1: Compute effective part base pixels (edit modifiers applied)
  const baseResult = computePartBasePixels(part, keyframe, currentFrame, resolvedEditModifiers);

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
    const modResult = applyPixelModifiers(part, activeMods, currentFrame, basePixels);
    pixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  } else {
    // P1-2: No keyframe pixel modifiers — reference basePixels directly instead of copying
    pixels = basePixels;
    void baseIsUnique; // preserved for future optimization
  }

  // Step 4: Apply pixel-level deformation animation modifiers
  if (applyPixelMods && part.animationModifiers && part.animationModifiers.length > 0) {
    const deformResult = applyPixelDeformAnimations(
      part, keyframe, pixels, currentFrame, frameRate,
      worldOffsetX, worldOffsetY, modOffsetX, modOffsetY,
    );
    pixels = deformResult.pixels;
    modOffsetX = deformResult.modOffsetX;
    modOffsetY = deformResult.modOffsetY;
  }

  // Step 5: Render pixels to canvas via ImageData
  const canvas = renderPixelGridToCanvas(pixels, effectiveWidth, effectiveHeight);

  return { canvas, offsetX: modOffsetX, offsetY: modOffsetY };
}

/**
 * Render a part in isolation (part edit mode).
 * Only the part is shown, centered on the canvas, with part-edit modifiers applied.
 * Translate modifiers become internal pixel shifts (not position offsets).
 */
export function renderPartEditMode(
  ctx: CanvasRenderingContext2D,
  part: Part,
  partEditModifiers: ModifierInstance[],
  canvasWidth: number,
  canvasHeight: number,
  currentFrame: number = 0,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Center the part on the canvas
  const centerX = Math.floor((canvasWidth - part.width) / 2);
  const centerY = Math.floor((canvasHeight - part.height) / 2);

  // M7: Resolve paramKeyframes and paramDrivers before applying pixel modifiers
  // This ensures ParamDriver-driven parameters take effect in part_edit mode
  const resolvedMods = (partEditModifiers.some(m =>
    (m.paramKeyframes && m.paramKeyframes.length > 0) ||
    (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some(d => d.enabled && !d.isBaked))
  ))
    ? resolveKeyframeModifierParams(partEditModifiers, currentFrame)
    : partEditModifiers;

  // Apply pixel-level modifiers
  const pixelModTypes: ModifierType[] = [
    'color_replace', 'outline', 'dither', 'pixel_displace',
    'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
  ];
  const activePixelMods = resolvedMods.filter(m => pixelModTypes.includes(m.type) && m.enabled);

  let pixels: PixelGrid;
  let modOffsetX = 0;
  let modOffsetY = 0;
  if (activePixelMods.length > 0) {
    const modResult = applyPixelModifiers(part, activePixelMods, currentFrame);
    pixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  } else {
    // P1-2: No pixel modifiers — reference original directly (ImageData render is read-only)
    pixels = part.pixels;
  }

  // Apply pixel shift from translate modifiers (internal shift, not position offset)
  // M7: Use resolvedMods so ParamDriver-driven offsetX/offsetY are applied
  const translateMod = resolvedMods.find(m => m.type === 'translate' && m.enabled);
  let shiftX = 0, shiftY = 0;
  if (translateMod) {
    shiftX = Math.round(Number(translateMod.params.offsetX) || 0);
    shiftY = Math.round(Number(translateMod.params.offsetY) || 0);
  }

  // Render pixels with shift and overflow offset
  const gridH = pixels.length;
  const gridW = pixels[0]?.length || 0;
  // Adjust the rendering origin: the original (0,0) of the part is at
  // (centerX - modOffsetX, centerY - modOffsetY) after overflow expansion
  const originX = centerX - modOffsetX;
  const originY = centerY - modOffsetY;

  ctx.imageSmoothingEnabled = false;

  // P0-1: Use ImageData for pixel rendering instead of per-pixel fillRect
  // Create a temp canvas at pixel grid size, then drawImage at (originX, originY)
  const tmpCanvas = acquireCanvas(gridW, gridH);
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.clearRect(0, 0, gridW, gridH);
  const imgData = tmpCtx.createImageData(gridW, gridH);
  const imgBuf = imgData.data;
  for (let y = 0; y < gridH; y++) {
    const srcY = y - shiftY;
    const row = pixels[srcY];
    const rowOff = y * gridW * 4;
    for (let x = 0; x < gridW; x++) {
      const srcX = x - shiftX;
      const color = (srcX >= 0 && srcX < gridW && srcY >= 0 && srcY < gridH && row)
        ? row[srcX]
        : null;
      if (color) {
        const packed = hexToRgbCached(color);
        const idx = rowOff + x * 4;
        imgBuf[idx]     = (packed >> 16) & 0xFF;
        imgBuf[idx + 1] = (packed >> 8) & 0xFF;
        imgBuf[idx + 2] = packed & 0xFF;
        imgBuf[idx + 3] = 255;
      }
    }
  }
  tmpCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(tmpCanvas, originX, originY);
  releaseCanvas(tmpCanvas);

  // Draw part boundary indicator (original part bounds, before modifier expansion)
  ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(centerX - 0.5, centerY - 0.5, part.width + 1, part.height + 1);

  // Draw pivot cross
  ctx.strokeStyle = 'rgba(255, 200, 50, 0.5)';
  ctx.lineWidth = 1;
  const pivotScreenX = centerX + part.pivotX;
  const pivotScreenY = centerY + part.pivotY;
  ctx.beginPath();
  ctx.moveTo(pivotScreenX - 4, pivotScreenY);
  ctx.lineTo(pivotScreenX + 4, pivotScreenY);
  ctx.moveTo(pivotScreenX, pivotScreenY - 4);
  ctx.lineTo(pivotScreenX, pivotScreenY + 4);
  ctx.stroke();
}
// ============================================================
// Frame Rendering
// ============================================================

/**
 * V4.1: Resolve the effective edit modifiers for a part at a given frame.
 * Uses step interpolation over part.partKeyframes: the most recent keyframe
 * at or before the current frame determines the modifier stack.
 * Falls back to part.editModifiers when no part keyframe covers the frame.
 * This function is standalone (no store dependency) so it can be used in the engine.
 */
function resolvePartEditModifiersForRender(part: Part, frame: number): ModifierInstance[] {
  const pkfs = part.partKeyframes || [];
  if (pkfs.length === 0) return part.editModifiers || [];
  // Step interpolation: binary search for the last part keyframe at or before frame
  // Sort only if needed (cache the sort on the first call per part edit session)
  const sorted = pkfs.length > 1 && pkfs.some((k, i) => i > 0 && k.frame < pkfs[i - 1].frame)
    ? [...pkfs].sort((a, b) => a.frame - b.frame)
    : pkfs;
  let lo = 0, hi = sorted.length - 1, prevIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].frame <= frame) {
      prevIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return prevIdx >= 0 ? sorted[prevIdx].editModifiers : (part.editModifiers || []);
}

// ============================================================
// Render Frame Helper Functions
// Extracted from renderFrame to reduce cyclomatic complexity.
// ============================================================

/**
 * Build the variable context for the current frame.
 * P4-4: Caches allActiveDrivers — only rebuilds when keyframes reference changes.
 * M8: Supports accumulator variables with cross-frame caching.
 */
function buildVariableContextForFrame(
  keyframes: Keyframe[],
  animationVariables: AnimationVariable[] | undefined,
  currentFrame: number,
): VariableContext {
  // P4-4: Cache allActiveDrivers — only rebuild when keyframes reference changes.
  // During normal playback (no edits), keyframes array is the same reference,
  // so this avoids O(keyframes × modifiers × drivers) scan every frame.
  const cacheKey = keyframes;
  if (getActiveDriversCache().keyframes !== cacheKey) {
    const allActiveDrivers: ParamDriver[] = [];
    if (animationVariables && animationVariables.length > 0) {
      for (const kf of keyframes) {
        for (const mod of kf.modifiers) {
          if (mod.paramDrivers) {
            for (const d of mod.paramDrivers) {
              if (d.enabled && !d.isBaked) allActiveDrivers.push(d);
            }
          }
        }
      }
    }
    getActiveDriversCache().keyframes = cacheKey;
    getActiveDriversCache().drivers = allActiveDrivers;
  }
  const allActiveDrivers = getActiveDriversCache().drivers;
  let variableContext: VariableContext;
  if (animationVariables && animationVariables.length > 0) {
    // Check for structural changes in variable definitions
    const varHash = animationVariables.map(v => `${v.id}:${v.mode ?? 'v'}`).join(',');
    const hasAccumulators = animationVariables.some(v => v.mode === 'accumulator');
    let prevCtx: VariableContext | undefined;

    if (hasAccumulators) {
      // For accumulator variables, we need the previous frame's context.
      // Use cached context if it's from the previous frame and variables haven't changed.
      if (cachedVariableContextFrame === currentFrame - 1 && cachedVariableContextHash === varHash) {
        prevCtx = cachedVariableContext;
      }
    }

    variableContext = buildVariableContext(animationVariables, allActiveDrivers, currentFrame, prevCtx);

    // Cache this frame's context for next frame (for accumulator support)
    if (hasAccumulators) {
      setCachedVariableContext(variableContext, currentFrame, varHash);
    }
  } else {
    variableContext = EMPTY_VARIABLE_CONTEXT; // P4-8: reuse shared empty context
  }
  return variableContext;
}

/**
 * Build part-to-bone binding lookup from skeletons.
 * P6: Caches the result — only rebuilds when skeletons reference changes.
 * During playback without edits, the same skeleton objects are reused.
 */
function buildPartBoneBindingsMap(
  skeletons: Skeleton[] | undefined,
): Map<string, Array<{ skeletonId: string; bone: Bone; weight: number }>> {
  if (!_partBoneBindingsCache.skeletonsRef || _partBoneBindingsCache.skeletonsRef !== skeletons) {
    const partBoneBindings = new Map<string, Array<{ skeletonId: string; bone: Bone; weight: number }>>();
    if (skeletons) {
      for (const skeleton of skeletons) {
        for (const bone of skeleton.bones) {
          for (const binding of bone.boundParts) {
            const existing = partBoneBindings.get(binding.partId) || [];
            existing.push({ skeletonId: skeleton.id, bone, weight: binding.weight });
            partBoneBindings.set(binding.partId, existing);
          }
        }
      }
    }
    _partBoneBindingsCache.skeletonsRef = skeletons ?? null;
    _partBoneBindingsCache.bindings = partBoneBindings;
  }
  return _partBoneBindingsCache.bindings;
}

/**
 * Apply global modifier transform as a "camera/world" transform.
 * V12: This wraps the entire parts rendering, applying global effects like
 * camera pan, rotation, zoom, shake, etc. to all parts simultaneously.
 * Returns a cleanup callback that restores the canvas state.
 */
function applyGlobalTransform(
  ctx: CanvasRenderingContext2D,
  globalModifiers: GlobalModifier[] | undefined,
  currentFrame: number,
  frameRate: number,
  canvasWidth: number,
  canvasHeight: number,
): { restore: () => void } {
  let globalTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  if (globalModifiers && globalModifiers.length > 0) {
    globalTransform = computeGlobalModifierTransform(globalModifiers, currentFrame, frameRate);
  }
  const hasGlobalTransform = globalTransform.translateX !== 0 || globalTransform.translateY !== 0 ||
    globalTransform.rotation !== 0 || globalTransform.scaleX !== 1 || globalTransform.scaleY !== 1;

  if (hasGlobalTransform) {
    ctx.save();
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.translate(globalTransform.translateX, globalTransform.translateY);
    ctx.rotate((globalTransform.rotation * Math.PI) / 180);
    ctx.scale(globalTransform.scaleX, globalTransform.scaleY);
    ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
  }

  return {
    restore: () => {
      if (hasGlobalTransform) {
        ctx.restore();
      }
    },
  };
}

/**
 * Resolve the effective keyframe for a single part at the current frame.
 * This includes:
 * - ParamDriver inheritance cache building
 * - Binary search for surrounding keyframes
 * - Interpolation between keyframes
 * - ParamDriver resolution with LRU caching
 * - Procedural animation application
 */
function resolvePartKeyframe(
  part: Part,
  kfByPart: Map<string, Keyframe[]>,
  currentFrame: number,
  variableContext: VariableContext,
  keyframesRef: Keyframe[],
  proceduralAnimations: ProceduralAnimation[] | undefined,
): Keyframe | null {
  const partKeyframes = kfByPart.get(part.id) || [];

  // P5-3: Pre-compute ParamDriver inheritance for all modifier types in this part.
  // Instead of calling collectActiveParamDrivers (O(K) per modifier) for each modifier,
  // walk the keyframes once and build a Map<modifierType, ParamDriver[]> cache.
  // This reduces O(modifiers × keyframes) to O(keyframes) for the inheritance lookup.
  const driverInheritanceCache = new Map<string, ParamDriver[] | undefined>();
  let hasAnyUndefinedDrivers = false;
  for (const kf of partKeyframes) {
    for (const mod of kf.modifiers) {
      if (mod.paramDrivers !== undefined) {
        // This keyframe defines drivers for this modifier type — update the cache
        // Only cache if this keyframe is at or before currentFrame
        if (kf.frame <= currentFrame) {
          driverInheritanceCache.set(mod.type, mod.paramDrivers);
        }
      } else {
        hasAnyUndefinedDrivers = true;
      }
    }
  }
  // If no modifier has undefined paramDrivers, no inheritance is needed
  const needsInheritance = hasAnyUndefinedDrivers;

  // Find surrounding keyframes — binary search O(log K) instead of linear O(K)
  let prevKf: Keyframe | null = null;
  let nextKf: Keyframe | null = null;

  if (partKeyframes.length > 0) {
    // Binary search: find the last keyframe with frame <= currentFrame
    let lo = 0, hi = partKeyframes.length - 1;
    let prevIdx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (partKeyframes[mid].frame <= currentFrame) {
        prevIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (prevIdx >= 0) prevKf = partKeyframes[prevIdx];
    if (prevIdx + 1 < partKeyframes.length) nextKf = partKeyframes[prevIdx + 1];
  }

  // Determine which keyframe to use for rendering
  let renderKf: Keyframe | null = prevKf;

  // If we have both prev and next, interpolate
  if (prevKf && nextKf && prevKf.frame !== nextKf.frame) {
    const t = (currentFrame - prevKf.frame) / (nextKf.frame - prevKf.frame);
    // P9: Cache key for interpolation — quantize t to 4 decimal places
    // to avoid cache misses from floating-point differences
    const interpCacheKey = `${prevKf.id}:${nextKf.id}:${t.toFixed(4)}`;
    const interpolatedMods = interpolateModifiers(
      prevKf.modifiers, nextKf.modifiers, t,
      prevKf.interpolationMode ?? 'linear',
      prevKf.bezierCP1,
      prevKf.bezierCP2,
      interpCacheKey,
    );
    renderKf = {
      ...prevKf,
      modifiers: interpolatedMods,
    };
  }

  // If no keyframe at this frame, use the part's default position
  if (!renderKf && partKeyframes.length > 0) {
    renderKf = partKeyframes[0];
  }

  // M6+M7: Resolve per-modifier param keyframes and/or param drivers FIRST,
  // so that procedural animations add their offsets on top of resolved values.
  // ParamDrivers now persist across keyframes via step-interpolation:
  // if a modifier doesn't define paramDrivers, it inherits from the nearest
  // earlier keyframe's modifier of the same type.
  // B4: Use LRU cache for modifier resolution — skip redundant per-part per-frame resolution.
  if (renderKf && renderKf.modifiers.some(m =>
    (m.paramKeyframes && m.paramKeyframes.length > 0) ||
    m.paramDrivers !== undefined ||
    // Also check if any modifier needs inherited drivers (paramDrivers undefined but
    // earlier keyframes might have them). We optimistically resolve if any modifier
    // has paramKeyframes or if there are keyframes with paramDrivers in the part.
    partKeyframes.some(kf => kf.modifiers.some(km =>
      km.paramDrivers !== undefined && km.paramDrivers.length > 0 &&
      km.paramDrivers.some(d => d.enabled && !d.isBaked)
    ))
  )) {
    // B4: Check modifier resolution cache
    const resolveCacheKey = `${part.id}:${currentFrame}`;
    const cachedResolve = getModifierResolveCacheKeyframesRef() === keyframesRef
      ? getModifierResolveCacheMap().get(resolveCacheKey)
      : undefined;

    if (cachedResolve) {
      renderKf = cachedResolve;
    } else {
      // Step 1: Collect inherited ParamDrivers for each modifier type.
      // P5-3: Use pre-computed driverInheritanceCache instead of O(K) scan per modifier.
      const resolvedMods = renderKf.modifiers.map(mod => {
        let effectiveDrivers = mod.paramDrivers;
        if (effectiveDrivers === undefined && needsInheritance) {
          // O(1) cache lookup instead of O(K) backward scan
          effectiveDrivers = driverInheritanceCache.get(mod.type);
        }
        return { ...mod, paramDrivers: effectiveDrivers };
      });

      // Step 2: Resolve paramKeyframes and ParamDrivers for each modifier.
      // No more keyframeEndFrame clamping — ParamDriver lifetime is controlled
      // by its own startFrame/endFrame, not by keyframe boundaries.
      // M8: Pass variableContext for paramSources resolution.
      renderKf = {
        ...renderKf,
        modifiers: resolveKeyframeModifierParams(
          resolvedMods,
          currentFrame,
          renderKf.interpolationMode ?? 'linear',
          renderKf.bezierCP1,
          renderKf.bezierCP2,
          variableContext,
        ),
      };

      // B4: Store in modifier resolution cache
      if (getModifierResolveCacheKeyframesRef() !== keyframesRef) {
        getModifierResolveCacheMap().clear();
        setModifierResolveCacheKeyframesRef(keyframesRef);
      }
      if (getModifierResolveCacheMap().size >= getFrameCacheMax()) {
        const firstKey = getModifierResolveCacheMap().keys().next().value;
        if (firstKey !== undefined) getModifierResolveCacheMap().delete(firstKey);
      }
      getModifierResolveCacheMap().set(resolveCacheKey, renderKf);
    }
  }

  // V2.0: Apply procedural animations to modifiers AFTER paramDriver resolution
  // so procedural offsets add on top of resolved base values
  if (renderKf && proceduralAnimations && proceduralAnimations.length > 0) {
    renderKf = {
      ...renderKf,
      modifiers: applyProceduralAnimations(renderKf.modifiers, proceduralAnimations, part.id, currentFrame),
    };
  }

  return renderKf;
}

/**
 * Apply bone-driven transforms to a part's keyframe.
 * Bone transforms are computed from skeleton pose data. This function applies
 * the bone's delta (from rest pose) as additive rotation and translation offsets
 * to the part's keyframe modifiers.
 */
function applyBoneDrivenTransforms(
  renderKf: Keyframe,
  partId: string,
  partBoneBindings: Map<string, Array<{ skeletonId: string; bone: Bone; weight: number }>>,
  boneTransforms: Map<string, Map<string, { rotation: number; headX: number; headY: number; tailX: number; tailY: number }>>,
): Keyframe {
  if (partBoneBindings.size === 0) return renderKf;

  const bindings = partBoneBindings.get(partId);
  if (!bindings || bindings.length === 0) return renderKf;

  let boneRotationOffset = 0;
  let boneTranslateX = 0;
  let boneTranslateY = 0;

  if (bindings.length === 1 && Math.abs(bindings[0].weight - 1.0) < 0.001) {
    // Single bone with full weight: apply as rigid transform
    const { skeletonId, bone } = bindings[0];
    const skeletonTransforms = boneTransforms.get(skeletonId);
    if (skeletonTransforms) {
      const boneTransform = skeletonTransforms.get(bone.id);
      if (boneTransform) {
        // Delta rotation from rest pose (poseRotation only, restRotation is base)
        boneRotationOffset = boneTransform.rotation - bone.restRotation;
        // Delta translation from rest position
        boneTranslateX = boneTransform.headX - bone.headX;
        boneTranslateY = boneTransform.headY - bone.headY;
      }
    }
  } else {
    // Multi-bone binding: simplified weighted average of bone deltas.
    // Per-pixel deformation is a future enhancement; for now we blend
    // rotation and translation by weight.
    let totalWeight = 0;
    for (const { skeletonId, bone, weight } of bindings) {
      const skeletonTransforms = boneTransforms.get(skeletonId);
      if (skeletonTransforms) {
        const boneTransform = skeletonTransforms.get(bone.id);
        if (boneTransform) {
          const deltaRotation = boneTransform.rotation - bone.restRotation;
          const deltaTranslateX = boneTransform.headX - bone.headX;
          const deltaTranslateY = boneTransform.headY - bone.headY;

          boneRotationOffset += deltaRotation * weight;
          boneTranslateX += deltaTranslateX * weight;
          boneTranslateY += deltaTranslateY * weight;
          totalWeight += weight;
        }
      }
    }
    // Normalize if weights don't sum to 1.0
    if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.001) {
      boneRotationOffset /= totalWeight;
      boneTranslateX /= totalWeight;
      boneTranslateY /= totalWeight;
    }
  }

  // Apply bone offsets to renderKf modifiers (additive to keyframe)
  if (boneRotationOffset !== 0 || boneTranslateX !== 0 || boneTranslateY !== 0) {
    const mods = [...renderKf.modifiers];

    // Apply rotation offset: add to existing rotate modifier or create one
    if (boneRotationOffset !== 0) {
      const rotateIdx = mods.findIndex(m => m.type === 'rotate' && m.enabled);
      if (rotateIdx !== -1) {
        const rotateMod = mods[rotateIdx];
        mods[rotateIdx] = {
          ...rotateMod,
          params: {
            ...rotateMod.params,
            angle: (Number(rotateMod.params.angle) || 0) + boneRotationOffset,
          },
        };
      } else {
        mods.push({
          id: `__bone_rotate_${partId}`,
          type: 'rotate',
          enabled: true,
          collapsed: false,
          params: { angle: boneRotationOffset },
          startFrame: -1,
          endFrame: -1,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          blendMode: 'add',
          coordinateMode: 'parent_local',
        });
      }
    }

    // Apply translation offset: add to existing translate modifier or create one
    if (boneTranslateX !== 0 || boneTranslateY !== 0) {
      const translateIdx = mods.findIndex(m => m.type === 'translate' && m.enabled);
      if (translateIdx !== -1) {
        const translateMod = mods[translateIdx];
        mods[translateIdx] = {
          ...translateMod,
          params: {
            ...translateMod.params,
            offsetX: (Number(translateMod.params.offsetX) || 0) + boneTranslateX,
            offsetY: (Number(translateMod.params.offsetY) || 0) + boneTranslateY,
          },
        };
      } else {
        mods.push({
          id: `__bone_translate_${partId}`,
          type: 'translate',
          enabled: true,
          collapsed: false,
          params: { offsetX: boneTranslateX, offsetY: boneTranslateY },
          startFrame: -1,
          endFrame: -1,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          blendMode: 'add',
          coordinateMode: 'parent_local',
        });
      }
    }

    return { ...renderKf, modifiers: mods };
  }

  return renderKf;
}

/**
 * Render the full frame to a canvas
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  parts: Part[],
  keyframes: Keyframe[],
  currentFrame: number,
  backgroundColor: string,
  effectTracks?: EffectTrack[],
  motionBlurStrokes?: MotionBlurStroke[],
  effectStrokes?: EffectStroke[],
  autoMotionBlur: boolean = false,
  autoMotionBlurIntensity: number = 0.5,
  skeletons?: Skeleton[],
  proceduralAnimations?: ProceduralAnimation[],
  canvasModifierTracks?: CanvasModifierTrack[],
  frameRate: number = 12,
  previewQuality: 'low' | 'medium' | 'high' = 'high',
  animationVariables?: AnimationVariable[],
  globalModifiers?: GlobalModifier[],
) {
  // Clear canvas
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // M8: Build variable context for the current frame
  const variableContext = buildVariableContextForFrame(keyframes, animationVariables, currentFrame);

  // V2.0: Compute bone transforms for all skeletons
  const boneTransforms = new Map<string, Map<string, { rotation: number; headX: number; headY: number; tailX: number; tailY: number }>>();
  if (skeletons) {
    for (const skeleton of skeletons) {
      boneTransforms.set(skeleton.id, computeBoneTransforms(skeleton, currentFrame));
    }
  }

  // V2.0: Build part-to-bone binding lookup from skeletons
  const partBoneBindings = buildPartBoneBindingsMap(skeletons);

  // Sort parts by z-index — P2-3: only sort if not already sorted
  const sortedParts = parts.length > 1 && parts.some((p, i) => i > 0 && p.zIndex < parts[i - 1].zIndex)
    ? [...parts].sort((a, b) => a.zIndex - b.zIndex)
    : parts;

  // B3: Use cached kfByPart — only rebuilds when keyframes reference changes.
  // During playback (no edits), the keyframes array reference stays the same,
  // so the index is reused across frames, saving O(K) work per frame.
  const kfByPart = getKfByPart(keyframes);

  // V12: Apply global modifier transform
  const globalTransformCleanup = applyGlobalTransform(ctx, globalModifiers, currentFrame, frameRate, canvasWidth, canvasHeight);

  perfTrack('renderFrame:partsLoop', () => {
  for (const part of sortedParts) {
    if (!part.visible) continue;

    // Resolve the effective keyframe for this part
    let renderKf = resolvePartKeyframe(part, kfByPart, currentFrame, variableContext, keyframes, proceduralAnimations);

    // Apply bone-driven transforms
    if (renderKf) {
      renderKf = applyBoneDrivenTransforms(renderKf, part.id, partBoneBindings, boneTransforms);
    }

    // V4.1: Resolve part-level edit modifiers for the current frame (supports part keyframes)
    const resolvedEditMods = resolvePartEditModifiersForRender(part, currentFrame);
    // M7+: No more keyframeEndFrame clamping for pixel-level ParamDrivers either.
    // ParamDriver lifetime is controlled by its own startFrame/endFrame.
    renderPartToCanvas(ctx, part, renderKf, canvasWidth / 2, canvasHeight / 2, currentFrame, autoMotionBlur, autoMotionBlurIntensity, keyframes, frameRate, previewQuality, resolvedEditMods);
  }
  }); // end perfTrack('renderFrame:partsLoop')

  // Render effect tracks, motion blur strokes, effect strokes, canvas modifiers
  perfTrack('renderFrame:effects', () => {
  // Render effect tracks for this frame
  if (effectTracks) {
    for (const effectTrack of effectTracks) {
      if (!effectTrack.visible) continue;
      // Find the keyframe at or before the current frame
      const kf = effectTrack.keyframes
        .filter((k) => k.frame <= currentFrame)
        .sort((a, b) => b.frame - a.frame)[0];
      if (!kf) continue;

      // Render the effect based on track type
      renderEffectTrackFrame(ctx, effectTrack, kf, currentFrame, canvasWidth, canvasHeight);
    }
  }

  // Render motion blur strokes for this frame
  if (motionBlurStrokes) {
    for (const stroke of motionBlurStrokes) {
      if (stroke.frame === currentFrame) {
        renderMotionBlurStroke(ctx, stroke);
      }
    }
  }

  // Render effect strokes for this frame
  if (effectStrokes) {
    for (const stroke of effectStrokes) {
      if (stroke.frame === currentFrame) {
        renderEffectStroke(ctx, stroke);
      }
    }
  }

  // V2.4: Apply canvas modifiers
  if (canvasModifierTracks && canvasModifierTracks.length > 0) {
    applyCanvasModifiers(ctx, canvasModifierTracks, currentFrame, canvasWidth, canvasHeight);
  }
  }); // end perfTrack('renderFrame:effects')

  // V12: Restore the global modifier transform
  globalTransformCleanup.restore();
}
/**
 * Render onion skin (previous/next frames with transparency)
 * B7: Uses persistent frame cache to avoid redundant full renders.
 * During playback, onion frames that are already cached are reused directly.
 */
function renderOnionSkin(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  parts: Part[],
  keyframes: Keyframe[],
  currentFrame: number,
  onionSkinFrames: number,
  backgroundColor: string,
) {
  ctx.save();

  for (let offset = 1; offset <= onionSkinFrames; offset++) {
    // Previous frame — B7: use cached frame if available
    const prevFrame = currentFrame - offset;
    if (prevFrame >= 0) {
      ctx.globalAlpha = 0.3 / offset;
      const cached = getCachedFrame(prevFrame, keyframes);
      if (cached) {
        // Draw cached frame directly — zero computation
        ctx.drawImage(cached, 0, 0);
        ctx.fillStyle = 'rgba(0, 100, 255, 0.2)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      } else {
        // Cache miss: render and cache for future reuse
        ctx.fillStyle = 'rgba(0, 100, 255, 0.2)';
        renderFrame(ctx, canvasWidth, canvasHeight, parts, keyframes, prevFrame, backgroundColor);
      }
    }

    // Next frame — B7: use cached frame if available
    const nextFrame = currentFrame + offset;
    if (nextFrame >= 0) {
      ctx.globalAlpha = 0.3 / offset;
      const cached = getCachedFrame(nextFrame, keyframes);
      if (cached) {
        ctx.drawImage(cached, 0, 0);
        ctx.fillStyle = 'rgba(255, 100, 0, 0.2)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      } else {
        ctx.fillStyle = 'rgba(255, 100, 0, 0.2)';
        renderFrame(ctx, canvasWidth, canvasHeight, parts, keyframes, nextFrame, backgroundColor);
      }
    }
  }

  ctx.restore();
}
// ============================================================
// Puppet Rendering
// ============================================================

/** Apply static horizontal mirror to a part canvas before rotation */
function mirrorPartCanvas(
  partCanvas: HTMLCanvasElement,
  partPivotX: number,
): { canvas: HTMLCanvasElement; pivotX: number } {
  const flippedCanvas = acquireCanvas(partCanvas.width, partCanvas.height);
  const flipCtx = flippedCanvas.getContext('2d')!;
  flipCtx.clearRect(0, 0, flippedCanvas.width, flippedCanvas.height);
  flipCtx.translate(flippedCanvas.width, 0);
  flipCtx.scale(-1, 1);
  flipCtx.drawImage(partCanvas, 0, 0);
  releaseCanvas(partCanvas);
  return { canvas: flippedCanvas, pivotX: flippedCanvas.width - partPivotX };
}

/** Build a part keyframe index for the current frame, keyed by partId */
function buildPartKfIndex(partKeyframes: Keyframe[] | undefined, currentFrame: number): Map<string, Keyframe> {
  const index = new Map<string, Keyframe>();
  if (partKeyframes && partKeyframes.length > 0) {
    for (const kf of partKeyframes) {
      if (kf.frame === currentFrame && kf.partId) {
        index.set(kf.partId, kf);
      }
    }
  }
  return index;
}

/**
 * Render puppet skeleton nodes to canvas.
 * This is the puppet render branch — called when a puppet clip is active.
 *
 * Puppet rendering pipeline:
 * 1. Interpolate puppet node keyframes (angle=hold, offset/stretch=lerp)
 * 2. Resolve sprite part for each node (direction + costume)
 * 3. Build world transforms via plug/socket hierarchy
 * 4. Sort by direction-dependent draw order
 * 5. Render each node's sprite with stretch-rotate-translate
 * 6. Render joint discs between parent-child connections
 */

export function renderPuppetNodes(
  ctx: CanvasRenderingContext2D,
  parts: Part[],
  skeleton: PuppetSkeleton,
  character: PuppetCharacter,
  puppetNodeKeyframes: PuppetNodeKeyframe[],
  currentFrame: number,
  canvasWidth: number,
  canvasHeight: number,
  frameRate: number = 12,
  _previewQuality: 'low' | 'medium' | 'high' = 'high',
  globalModifiers?: GlobalModifier[],
  /** Part keyframes — used to resolve pixel-level modifiers for puppet sprites.
   *  Without this, keyframe modifiers (color_replace, outline, wave_deform, etc.)
   *  are not applied to puppet sprites, only to non-puppet skeleton marks. */
  partKeyframes?: Keyframe[],
): void {
  // ---- Step 1: Keyframe interpolation ----
  const interpolatedValues = interpolateNodeKeyframes(skeleton, puppetNodeKeyframes, currentFrame);

  // ---- Step 2: Sprite resolution ----
  const { spritePartMap } = resolveSpriteParts(parts, skeleton, character);

  // ---- Step 3: World transform computation ----
  const rootNode = skeleton.nodes.find(n => !n.plug);
  const latitude = rootNode ? (interpolatedValues.get(rootNode.id)?.viewLatitude ?? 0) : 0;
  const worldTransforms = computePuppetWorldTransforms(skeleton, interpolatedValues, canvasWidth, canvasHeight, latitude);

  // ---- Step 4: Direction-dependent draw order ----
  const drawOrderedNodes = computeDirectionDrawOrder(skeleton);

  // ---- Step 4.5: Apply global modifier transform (camera/scene shake/pan/zoom) ----
  let globalTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  if (globalModifiers && globalModifiers.length > 0) {
    globalTransform = computeGlobalModifierTransform(globalModifiers, currentFrame, frameRate);
  }
  const hasGlobalTransform = globalTransform.translateX !== 0 || globalTransform.translateY !== 0 ||
    globalTransform.rotation !== 0 || globalTransform.scaleX !== 1 || globalTransform.scaleY !== 1;

  if (hasGlobalTransform) {
    ctx.save();
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.translate(globalTransform.translateX, globalTransform.translateY);
    ctx.rotate((globalTransform.rotation * Math.PI) / 180);
    ctx.scale(globalTransform.scaleX, globalTransform.scaleY);
    ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
  }

  // ---- Step 4.7: Build Part keyframe index for sprite modifier resolution ----
  const partKfByPartId = buildPartKfIndex(partKeyframes, currentFrame);

  // ---- Step 5: Render each node's sprite ----
  for (const node of drawOrderedNodes) {
    if (!node.visible) continue;

    const part = spritePartMap.get(node.id);
    if (!part) continue;

    const wt = worldTransforms.get(node.id);
    if (!wt) continue;

    const mirrorDirection = skeleton.currentDirection;
    const shouldMirror = shouldMirrorDirection(node, mirrorDirection);

    ctx.save();
    ctx.translate(wt.worldX, wt.worldY);

    // Create part canvas with pixel-level modifiers for puppet sprites
    const spriteKf = partKfByPartId.get(part.id) ?? null;
    const partCanvasResult = createPartCanvas(part, spriteKf, true, currentFrame, frameRate);
    let partCanvas = partCanvasResult.canvas;
    let partPivotX = part.pivotX + partCanvasResult.offsetX;
    let partPivotY = part.pivotY + partCanvasResult.offsetY;

    // Static mirror: flip before rotation so rotation direction matches bone/drag
    if (shouldMirror) {
      const mirrored = mirrorPartCanvas(partCanvas, partPivotX);
      partCanvas = mirrored.canvas;
      partPivotX = mirrored.pivotX;
    }

    // 4× upscale pixel-perfect rotation
    const rotResult = renderPixelPerfectRotation(partCanvas, wt.worldAngle, wt.worldStretch, partPivotX, partPivotY);
    const rotatedCanvas = rotResult.canvas;

    ctx.imageSmoothingEnabled = false;
    const drawX = Math.round(wt.worldX - rotResult.resultPivotX) + 0.5;
    const drawY = Math.round(wt.worldY - rotResult.resultPivotY) + 0.5;
    ctx.drawImage(rotatedCanvas, drawX, drawY);

    if (rotatedCanvas !== partCanvas) releaseCanvas(rotatedCanvas);
    releaseCanvas(partCanvas);
    ctx.restore();
  }

  // ---- Step 6: Render joint discs ----
  renderJointDiscs(ctx, skeleton, worldTransforms, latitude);

  // Restore global modifier transform
  if (hasGlobalTransform) {
    ctx.restore();
  }
}

/**
 * Render a single frame to a canvas for export
 */
export function renderFrameToCanvas(
  canvasWidth: number,
  canvasHeight: number,
  parts: Part[],
  keyframes: Keyframe[],
  frame: number,
  backgroundColor: string,
  effectTracks?: EffectTrack[],
  motionBlurStrokes?: MotionBlurStroke[],
  effectStrokes?: EffectStroke[],
  autoMotionBlur: boolean = false,
  autoMotionBlurIntensity: number = 0.5,
  skeletons?: Skeleton[],
  proceduralAnimations?: ProceduralAnimation[],
  canvasModifierTracks?: CanvasModifierTrack[],
  previewQuality: 'low' | 'medium' | 'high' = 'high',
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
  puppetSkeletons?: PuppetSkeleton[],
  puppetCharacters?: PuppetCharacter[],
  puppetNodeKeyframes?: PuppetNodeKeyframe[],
  frameRate: number = 12,
): HTMLCanvasElement {
  // P0-2: Use canvas pool for export too
  const canvas = acquireCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d')!;
  renderFrame(ctx, canvasWidth, canvasHeight, parts, keyframes, frame, backgroundColor, effectTracks, motionBlurStrokes, effectStrokes, autoMotionBlur, autoMotionBlurIntensity, skeletons, proceduralAnimations, canvasModifierTracks, frameRate, previewQuality, animationVariables, globalModifiers);

  // Render puppet nodes on the same canvas (mirrors PixelCanvas playback flow)
  if (puppetSkeletons && puppetCharacters && puppetSkeletons.length > 0) {
    for (const character of puppetCharacters) {
      const skeleton = puppetSkeletons.find(s => s.id === character.puppetSkeletonId);
      if (!skeleton) continue;
      const nodeKeyframes = puppetNodeKeyframes ?? [];
      renderPuppetNodes(
        ctx, parts, skeleton, character, nodeKeyframes,
        frame, canvasWidth, canvasHeight, frameRate,
        previewQuality, globalModifiers, keyframes,
      );
    }
  }

  return canvas;
}
