// ============================================================
// PixelMorpher - Puppet Utility Functions
// Moved from puppet-render.ts (deleted)
// ============================================================

import type {
  PixelGrid,
  PuppetNode,
  PuppetDirection,
  CostumeSet,
} from '../types';
import type { Node as UnifiedNode, Sprite } from '../unified-types';
import { PUPPET_DIRECTIONS, DIRECTION_MIRROR } from '../types';
import { acquireCanvas, releaseCanvas } from './canvas-pool';
import { getRotationCacheKey, getCachedRotation, setCachedRotation } from './render-cache';

export interface PixelPerfectRotationResult {
  canvas: HTMLCanvasElement;
  /** Pivot X position in the rotated output canvas (in native pixels) */
  resultPivotX: number;
  /** Pivot Y position in the rotated output canvas (in native pixels) */
  resultPivotY: number;
}

function downsample4x(
  srcCanvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
): HTMLCanvasElement {
  // Guard: zero-sized canvases cannot be used with drawImage
  if (targetW <= 0 || targetH <= 0 || srcCanvas.width <= 0 || srcCanvas.height <= 0) {
    const fallback = acquireCanvas(Math.max(1, targetW), Math.max(1, targetH));
    const fallbackCtx = fallback.getContext('2d')!;
    fallbackCtx.clearRect(0, 0, Math.max(1, targetW), Math.max(1, targetH));
    return fallback;
  }
  const result = acquireCanvas(targetW, targetH);
  const ctx = result.getContext('2d')!;
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, targetW, targetH);
  return result;
}


function cloneCanvasForCache(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}


export function renderPixelPerfectRotation(
  spriteCanvas: HTMLCanvasElement,
  angle: number,
  stretchY: number = 1,
  pivotX: number = 0,
  pivotY: number = 0,
): PixelPerfectRotationResult {
  // No rotation needed — pivot stays unchanged
  if (angle === 0 && stretchY === 1) {
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  const sw = spriteCanvas.width;
  const sh = spriteCanvas.height;

  // Guard: zero-sized source canvas or zero stretch would produce invalid canvases
  if (sw <= 0 || sh <= 0 || stretchY <= 0) {
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  // ---- Cache lookup ----
  // H13: 缓存里存的是独立 canvas（非池化），命中时再拷一份池化 canvas 返回，
  // 这样调用方沿用既有的 release 语义永远安全，不会污染缓存。
  const cacheKey = getRotationCacheKey(spriteCanvas, angle, stretchY, pivotX, pivotY);
  const cached = getCachedRotation(cacheKey);
  if (cached) {
    const copy = acquireCanvas(cached.canvas.width, cached.canvas.height);
    copy.getContext('2d')!.drawImage(cached.canvas, 0, 0);
    return {
      canvas: copy,
      resultPivotX: cached.resultPivotX,
      resultPivotY: cached.resultPivotY,
    };
  }

  const UPSCALE = 4;

  // Step 1: Create 4x upscaled canvas with stretch applied
  const upW = Math.ceil(sw * UPSCALE);
  const upH = Math.ceil(sh * UPSCALE * stretchY);

  // Guard: computed dimensions must be > 0
  if (upW <= 0 || upH <= 0) {
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }
  const upCanvas = acquireCanvas(upW, upH);
  const upCtx = upCanvas.getContext('2d')!;
  upCtx.clearRect(0, 0, upW, upH);
  upCtx.imageSmoothingEnabled = false;

  // Draw sprite upscaled with stretchY
  upCtx.drawImage(spriteCanvas, 0, 0, sw, sh, 0, 0, sw * UPSCALE, sh * UPSCALE * stretchY);

  // If no rotation (stretch only), pivot position is preserved
  if (angle === 0) {
    // H12: 下采样目标必须按拉伸缩放，否则拉伸被静默擦除
    const stretchedH = Math.max(1, Math.round(sh * stretchY));
    const result = downsample4x(upCanvas, sw, stretchedH);
    releaseCanvas(upCanvas);
    const resultPivotY = pivotY * stretchY;
    // Store in cache
    setCachedRotation(cacheKey, { canvas: cloneCanvasForCache(result), resultPivotX: pivotX, resultPivotY });
    return { canvas: result, resultPivotX: pivotX, resultPivotY };
  }

  // Step 2: Calculate bounding box after rotation on the upscaled canvas
  const pivotUpX = pivotX * UPSCALE;
  const pivotUpY = pivotY * UPSCALE * stretchY;
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  // Compute rotated corners
  const corners = [
    { x: 0, y: 0 },
    { x: upW, y: 0 },
    { x: 0, y: upH },
    { x: upW, y: upH },
  ];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    const dx = c.x - pivotUpX;
    const dy = c.y - pivotUpY;
    const rx = dx * cosA - dy * sinA + pivotUpX;
    const ry = dx * sinA + dy * cosA + pivotUpY;
    minX = Math.min(minX, rx);
    minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx);
    maxY = Math.max(maxY, ry);
  }

  const rotW = Math.ceil(maxX - minX);
  const rotH = Math.ceil(maxY - minY);

  // Guard: degenerate rotation producing zero-sized bounding box
  if (rotW <= 0 || rotH <= 0) {
    releaseCanvas(upCanvas);
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  // Compute the pivot position in the rotated upscaled canvas.
  // The rotation keeps the pivot at (pivotUpX, pivotUpY), but the canvas is
  // then shifted by (-minX, -minY), so the pivot moves to:
  //   (pivotUpX - minX, pivotUpY - minY) in the rotated upscaled canvas.
  // After downsample by UPSCALE, the pivot in the native-resolution result is:
  //   ((pivotUpX - minX) / UPSCALE, (pivotUpY - minY) / UPSCALE)
  const resultPivotX = (pivotUpX - minX) / UPSCALE;
  const resultPivotY = (pivotUpY - minY) / UPSCALE;

  // Step 3: Create rotated upscaled canvas
  const rotCanvas = acquireCanvas(rotW, rotH);
  const rotCtx = rotCanvas.getContext('2d')!;
  rotCtx.clearRect(0, 0, rotW, rotH);
  rotCtx.imageSmoothingEnabled = false;
  rotCtx.translate(-minX, -minY);
  rotCtx.translate(pivotUpX, pivotUpY);
  rotCtx.rotate(rad);
  rotCtx.translate(-pivotUpX, -pivotUpY);
  rotCtx.drawImage(upCanvas, 0, 0);
  releaseCanvas(upCanvas);

  // Step 4: Downsample back to native resolution with nearest-neighbor
  const nativeW = Math.ceil(rotW / UPSCALE);
  const nativeH = Math.ceil(rotH / UPSCALE);
  const result = downsample4x(rotCanvas, nativeW, nativeH);
  releaseCanvas(rotCanvas);

  // Store in cache
  setCachedRotation(cacheKey, { canvas: cloneCanvasForCache(result), resultPivotX, resultPivotY });
  return { canvas: result, resultPivotX, resultPivotY };
}


export function resolvePuppetNodeSprite(
  node: PuppetNode,
  direction: PuppetDirection,
  activeCostumeSet: CostumeSet | null,
  sprites: import('../unified-types').Sprite[],
): import('../unified-types').Sprite | null {
  let spriteId: string | null = null;

  // Step 1: Check costume set override
  if (activeCostumeSet) {
    const costumeKey = `${node.id}:${direction}`;
    spriteId = activeCostumeSet.spriteMap[costumeKey] ?? null;
    if (!spriteId) {
      // Try default direction key
      const defaultKey = `${node.id}:default`;
      spriteId = activeCostumeSet.spriteMap[defaultKey] ?? null;
    }
  }

  // Step 2: Check direction-specific sprite override
  if (!spriteId && node.directionSprites) {
    spriteId = node.directionSprites[direction] ?? null;
  }

  // Step 4: Fall back to default sprite
  if (!spriteId) {
    spriteId = node.spritePartId;
  }

  if (!spriteId) return null;

  return sprites.find(p => p.id === spriteId) ?? null;
}


/**
 * Resolve the sprite for a new Node.
 * New pipeline: Node.sprite is already resolved (no Part lookup needed).
 */
export function resolveNodeSprite(node: UnifiedNode): Sprite | null {
  return node.sprite ?? null;
}
