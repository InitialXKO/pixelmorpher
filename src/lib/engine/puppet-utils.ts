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
import { composeLocalAffine, computeAffineFrame } from './affine';

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
  // 复合局部仿射（旋转之外）：scaleX ≠ 1 或带 skew 时走复合路径——
  // 在 4× 空间先烘焙 S·K、旋转殿后（结合律保证与原生一次画完逐点等价）。
  extra?: { scaleX?: number; skews?: Array<{ skewX: number; skewY: number }> },
): PixelPerfectRotationResult {
  const scaleX = extra?.scaleX ?? 1;
  const skews = extra?.skews ?? [];
  const hasComposite = scaleX !== 1 || skews.length > 0;

  // No transform needed — pivot stays unchanged
  if (angle === 0 && stretchY === 1 && !hasComposite) {
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  const sw = spriteCanvas.width;
  const sh = spriteCanvas.height;

  // Guard: zero-sized source canvas would produce invalid canvases.
  // Zero/negative stretch keeps the historical diagonal-path bail-out;
  // the composite path handles it through its affine frame math instead.
  if (sw <= 0 || sh <= 0 || (!hasComposite && stretchY <= 0)) {
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  // ---- Cache lookup ----
  // H13: 缓存里存的是独立 canvas（非池化），命中时再拷一份池化 canvas 返回，
  // 这样调用方沿用既有的 release 语义永远安全，不会污染缓存。
  const skewsKey = skews.map(s => `${Math.round(s.skewX * 100)},${Math.round(s.skewY * 100)}`).join(';');
  const cacheKey = getRotationCacheKey(spriteCanvas, angle, stretchY, pivotX, pivotY, scaleX, skewsKey);
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

  if (hasComposite) {
    return renderCompositeThenRotate(spriteCanvas, angle, pivotX, pivotY, scaleX, stretchY, skews, cacheKey);
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

/**
 * 复合路径：scaleX / skew 存在时的像素完美旋转。
 * 先在 4× 空间把局部仿射 S·K（scaleX、stretch、skew）一次烘焙，再绕枢轴
 * 旋转、4× 下采样。变换链 v' = T·R·S·K·v 中旋转本就是最外层，结合律保证
 * 与原生一次画完逐点等价；负 scaleX（动态镜像）由角点 min/max 与仿射
 * 光栅化自然吸收。第一步必须在 4× 空间做：在 1× 先变换会把剪切锯齿焊死。
 */
function renderCompositeThenRotate(
  spriteCanvas: HTMLCanvasElement,
  angle: number,
  pivotX: number,
  pivotY: number,
  scaleX: number,
  stretchY: number,
  skews: Array<{ skewX: number; skewY: number }>,
  cacheKey: string,
): PixelPerfectRotationResult {
  const UPSCALE = 4;
  const sw = spriteCanvas.width;
  const sh = spriteCanvas.height;
  const m = composeLocalAffine(scaleX, stretchY, skews);
  const frame = computeAffineFrame(sw, sh, pivotX, pivotY, m);

  // 退化（scaleX=0 等使包围盒塌缩）：原生路径下该节点不可见，
  // 返回透明 1×1 而不是把原图画出来。
  if (!(frame.width > 0) || !(frame.height > 0)) {
    const blank = acquireCanvas(1, 1);
    blank.getContext('2d')!.clearRect(0, 0, 1, 1);
    return { canvas: blank, resultPivotX: 0, resultPivotY: 0 };
  }

  // Step 1: 4× 空间烘焙 S·K（单次仿射采样；点 p ↦ 4·M(p) − 4·min）
  const upW = Math.ceil(frame.width * UPSCALE);
  const upH = Math.ceil(frame.height * UPSCALE);
  const upCanvas = acquireCanvas(upW, upH);
  const upCtx = upCanvas.getContext('2d')!;
  upCtx.clearRect(0, 0, upW, upH);
  upCtx.imageSmoothingEnabled = false;
  upCtx.translate(-frame.minX * UPSCALE, -frame.minY * UPSCALE);
  upCtx.scale(UPSCALE, UPSCALE);
  upCtx.transform(m.a, m.b, m.c, m.d, 0, 0);
  upCtx.drawImage(spriteCanvas, 0, 0);

  const pivotUpX = frame.pivotX * UPSCALE;
  const pivotUpY = frame.pivotY * UPSCALE;

  // 无旋转：直接下采样，枢轴即仿射后枢轴
  if (angle === 0) {
    const nativeW = Math.max(1, Math.round(frame.width));
    const nativeH = Math.max(1, Math.round(frame.height));
    const result = downsample4x(upCanvas, nativeW, nativeH);
    releaseCanvas(upCanvas);
    setCachedRotation(cacheKey, { canvas: cloneCanvasForCache(result), resultPivotX: frame.pivotX, resultPivotY: frame.pivotY });
    return { canvas: result, resultPivotX: frame.pivotX, resultPivotY: frame.pivotY };
  }

  // Step 2: 旋转后包围盒（与对角路径同一套公式，枢轴/尺寸换成仿射后口径）
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
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
  if (rotW <= 0 || rotH <= 0) {
    releaseCanvas(upCanvas);
    const blank = acquireCanvas(1, 1);
    blank.getContext('2d')!.clearRect(0, 0, 1, 1);
    return { canvas: blank, resultPivotX: 0, resultPivotY: 0 };
  }
  const resultPivotX = (pivotUpX - minX) / UPSCALE;
  const resultPivotY = (pivotUpY - minY) / UPSCALE;

  // Step 3: 在 4× 空间绕枢轴旋转
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

  // Step 4: 下采样回原生分辨率
  const nativeW = Math.ceil(rotW / UPSCALE);
  const nativeH = Math.ceil(rotH / UPSCALE);
  const result = downsample4x(rotCanvas, nativeW, nativeH);
  releaseCanvas(rotCanvas);

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
