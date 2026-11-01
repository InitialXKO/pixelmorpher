// ============================================================
// PixelMorpher - Inpainting Library
// ============================================================
// Provides Telea-style inpainting for pixel art.
// No ML model required — pure algorithmic approach.

import type { PixelGrid, PixelColor } from './types';
import { subToPx, type Sprite } from './unified-types';
import { rgbToHex } from './engine/utils';

/**
 * Telea-style inpainting algorithm for pixel art.
 * Fills masked pixels using surrounding pixel data via iterative
 * boundary propagation. Optimized for small pixel art images.
 *
 * The algorithm works by iteratively filling from the boundary of
 * the masked region inward. At each step, boundary pixels are filled
 * with a weighted average of their non-masked neighbors within a
 * given radius. This produces smooth, natural-looking fills that
 * blend well with surrounding pixel data, making it ideal for
 * removing small objects, cleaning up artifacts, or filling gaps
 * in pixel art sprites.
 *
 * @param pixels - The pixel grid to inpaint
 * @param mask - Set of "x,y" strings identifying pixels to inpaint
 * @param radius - Search radius for neighbor sampling (default 3)
 * @returns New pixel grid with masked areas filled
 */
export function inpaintPixels(
  pixels: PixelGrid,
  mask: Set<string>,
  radius: number = 3
): PixelGrid {
  const height = pixels.length;
  const width = height > 0 ? pixels[0].length : 0;

  if (width === 0 || height === 0 || mask.size === 0) return pixels;

  // Deep copy pixels
  const result: PixelGrid = pixels.map(row => [...row]);

  // Convert mask to 2D boolean array for O(1) lookup
  const maskGrid: boolean[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => false)
  );
  for (const key of mask) {
    const [x, y] = key.split(',').map(Number);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      maskGrid[y][x] = true;
    }
  }

  // Iteratively fill from boundary inward using weighted average of neighbors.
  // Each iteration fills the outermost layer of mask pixels that have
  // at least one non-mask neighbor, then marks them as filled, and
  // repeats until all mask pixels are filled or no more progress can be made.
  const remaining = new Set(mask);
  const maxIterations = Math.max(width, height);

  for (let iteration = 0; iteration < maxIterations && remaining.size > 0; iteration++) {
    const toFill: { x: number; y: number; color: PixelColor }[] = [];

    for (const key of remaining) {
      const [x, y] = key.split(',').map(Number);
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      // Collect weighted color contributions from non-mask neighbors within radius
      let totalR = 0, totalG = 0, totalB = 0, totalWeight = 0;
      let hasNeighbor = false;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const nColor = result[ny][nx];
          // Skip null (transparent) and still-masked pixels
          if (nColor === null || maskGrid[ny][nx]) continue;

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > radius) continue;

          // Weight inversely proportional to distance squared (Telea-style)
          const weight = 1 / (dist * dist + 0.001);
          const r = parseInt(nColor.slice(1, 3), 16);
          const g = parseInt(nColor.slice(3, 5), 16);
          const b = parseInt(nColor.slice(5, 7), 16);

          totalR += r * weight;
          totalG += g * weight;
          totalB += b * weight;
          totalWeight += weight;
          hasNeighbor = true;
        }
      }

      if (hasNeighbor && totalWeight > 0) {
        const r = Math.round(totalR / totalWeight);
        const g = Math.round(totalG / totalWeight);
        const b = Math.round(totalB / totalWeight);
        const color = rgbToHex(r, g, b);
        toFill.push({ x, y, color });
      }
    }

    if (toFill.length === 0) break;

    // Apply fills and update mask for next iteration
    for (const { x, y, color } of toFill) {
      result[y][x] = color;
      maskGrid[y][x] = false;
      remaining.delete(`${x},${y}`);
    }
  }

  // For any remaining unfilled mask pixels (isolated regions with no neighbors),
  // set them to null (transparent) as a fallback
  for (const key of remaining) {
    const [x, y] = key.split(',').map(Number);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      result[y][x] = null;
    }
  }

  return result;
}

// ============================================================
// 画布掩码 → 新精灵（选区/SAM 提取的现行落点：全局精灵表）
// ============================================================
// Part 退役后，提取的产物是全局精灵表里的新精灵（addSprite +
// setSpritePixels）。采样与 plug 口径与画布选区提取（use-canvas-state
// 的 extractSelectionAsPart）逐式一致，保证同一掩码、同一画布在两条
// 提取路径（手动选区 / SAM 选区）下产出同一精灵：
//   - 精灵按入参顺序逐个试，画布点 (px,py) 映到精灵局部
//     (px-(画布宽/2-plugX), py-(画布高/2-plugY))，第一个非透明命中胜出；
//   - 结果裁到命中包围盒，pivot 取命中像素质心；
//   - plug 按选区提取同式回算（addSprite 缺省 plug 为中心，
//     defPivot 即该缺省值）。

export interface MaskExtractedSprite {
  width: number;
  height: number;
  pixels: PixelGrid;
  /** 新精灵 plug（像素单位，与 addSprite 的 opts.plugX/plugY 同口径） */
  plugX: number;
  plugY: number;
}

export function buildSpriteFromCanvasMask(
  sprites: readonly Sprite[],
  canvasWidth: number,
  canvasHeight: number,
  mask: ReadonlySet<string>,
): MaskExtractedSprite | null {
  if (mask.size === 0) return null;
  const offsetX = canvasWidth / 2;
  const offsetY = canvasHeight / 2;

  const selectedPixels: { x: number; y: number; color: string }[] = [];
  for (const key of mask) {
    const comma = key.indexOf(',');
    if (comma < 0) continue;
    const px = Number(key.slice(0, comma));
    const py = Number(key.slice(comma + 1));
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    for (const sprite of sprites) {
      const pivotX = sprite.plug ? subToPx(sprite.plug.x) : Math.floor(sprite.width / 2);
      const pivotY = sprite.plug ? subToPx(sprite.plug.y) : Math.floor(sprite.height / 2);
      const lx = px - (offsetX - pivotX);
      const ly = py - (offsetY - pivotY);
      if (lx < 0 || lx >= sprite.width || ly < 0 || ly >= sprite.height) continue;
      const color = sprite.data[ly]?.[lx];
      if (color !== null && color !== undefined) {
        selectedPixels.push({ x: px, y: py, color });
        break;
      }
    }
  }
  if (selectedPixels.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of selectedPixels) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const partW = maxX - minX + 1;
  const partH = maxY - minY + 1;

  const colorMap = new Map<string, string>();
  for (const p of selectedPixels) colorMap.set(`${p.x},${p.y}`, p.color);

  const pixels: PixelGrid = [];
  let sumX = 0, sumY = 0, count = 0;
  for (let y = 0; y < partH; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < partW; x++) {
      const color = colorMap.get(`${minX + x},${minY + y}`);
      if (color) {
        row.push(color);
        sumX += x;
        sumY += y;
        count++;
      } else {
        row.push(null);
      }
    }
    pixels.push(row);
  }
  if (count === 0) return null;

  const pivotX = Math.round(sumX / count);
  const pivotY = Math.round(sumY / count);
  // addSprite 默认 plug 为中心（px）；选区提取算式里的 defPivot 即此默认值
  const defPivotX = Math.floor(partW / 2);
  const defPivotY = Math.floor(partH / 2);
  return {
    width: partW,
    height: partH,
    pixels,
    plugX: pivotX + (minX - Math.floor(canvasWidth / 2) + defPivotX - (defPivotX - pivotX)),
    plugY: pivotY + (minY - Math.floor(canvasHeight / 2) + defPivotY - (defPivotY - pivotY)),
  };
}

/**
 * Convert SAM mask (Float32Array) to a Set of "x,y" pixel coordinates.
 * Maps from normalized mask coordinates to canvas pixel coordinates.
 *
 * SAM returns masks at a reduced resolution (e.g., 256x256), so this
 * function scales the mask coordinates up to the target canvas size.
 * Pixels with values above the threshold are included in the selection.
 *
 * @param maskData - Raw Float32Array mask from SAM (values 0-1)
 * @param maskShape - [height, width] of the mask
 * @param canvasWidth - Target canvas width in pixels
 * @param canvasHeight - Target canvas height in pixels
 * @param threshold - Minimum mask value to include (default 0.5)
 * @returns Set of "x,y" coordinate strings for selected pixels
 */
export function samMaskToSelectionMask(
  maskData: Float32Array,
  maskShape: [number, number],
  canvasWidth: number,
  canvasHeight: number,
  threshold: number = 0.5
): Set<string> {
  const [maskH, maskW] = maskShape;
  const result = new Set<string>();

  for (let my = 0; my < maskH; my++) {
    for (let mx = 0; mx < maskW; mx++) {
      const value = maskData[my * maskW + mx];
      if (value >= threshold) {
        // Scale mask coordinates to canvas coordinates
        const cx = Math.floor((mx / maskW) * canvasWidth);
        const cy = Math.floor((my / maskH) * canvasHeight);
        if (cx >= 0 && cx < canvasWidth && cy >= 0 && cy < canvasHeight) {
          result.add(`${cx},${cy}`);
        }
      }
    }
  }

  return result;
}
