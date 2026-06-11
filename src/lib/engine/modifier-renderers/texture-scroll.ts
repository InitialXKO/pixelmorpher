// ============================================================
// PixelMorpher - Texture Scroll Modifier Renderer
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { lerpColor } from '../color-utils';
import { modifierGuard, elapsedSeconds, emptyGrid } from './shared';

export function applyTextureScroll(
  pixels: PixelGrid,
  width: number,
  height: number,
  params: Record<string, ModifierParamValue>,
  currentFrame: number,
  frameRate: number,
  weight: number,
): PixelGrid {
  const grid = modifierGuard(pixels, weight);
  if (!grid) return pixels;
  const { h, w } = grid;

  const scrollDirection = String(params.scrollDirection || 'horizontal');
  const diagonalAngle = Number(params.diagonalAngle ?? 45);
  const scrollSpeed = Number(params.scrollSpeed ?? 30);
  const scrollMode = String(params.scrollMode || 'loop');
  const seamlessMode = String(params.seamlessMode || 'require_seamless');

  if (scrollSpeed === 0) return pixels;

  // Compute elapsed time in seconds
  const elapsed = elapsedSeconds(currentFrame, frameRate);

  // Compute raw offset distance in pixels, scaled by weight
  const rawOffset = scrollSpeed * elapsed;
  const offset = rawOffset * weight;

  // For horizontal/vertical, the dimension size is the wrap period
  // For diagonal, we use the projection onto each axis
  let offsetX: number;
  let offsetY: number;

  if (scrollDirection === 'vertical') {
    offsetX = 0;
    offsetY = offset;
  } else if (scrollDirection === 'diagonal') {
    const angleRad = (diagonalAngle * Math.PI) / 180;
    offsetX = offset * Math.cos(angleRad);
    offsetY = offset * Math.sin(angleRad);
  } else {
    // horizontal
    offsetX = offset;
    offsetY = 0;
  }

  // Apply scroll mode
  if (scrollMode === 'loop') {
    // Simple wrap-around modulo
    if (w > 0) offsetX = ((offsetX % w) + w) % w;
    if (h > 0) offsetY = ((offsetY % h) + h) % h;
  } else if (scrollMode === 'bounce_loop') {
    // Triangle wave: bounces back and forth with period = 2 * dimension
    // offset = dim - |((rawOffset % (2*dim)) - dim)|
    // But we use the weighted offset
    if (w > 0 && offsetX !== 0) {
      const absOff = Math.abs(offsetX);
      const period = 2 * w;
      const phase = absOff % period;
      const triangle = phase < w ? phase : period - phase;
      offsetX = Math.sign(offsetX) * triangle;
    }
    if (h > 0 && offsetY !== 0) {
      const absOff = Math.abs(offsetY);
      const period = 2 * h;
      const phase = absOff % period;
      const triangle = phase < h ? phase : period - phase;
      offsetY = Math.sign(offsetY) * triangle;
    }
  } else if (scrollMode === 'bounce_canvas') {
    // Bounce within the canvas, no wrap-around
    // Compute the max travel distance
    const maxDist = Math.sqrt((w / 2) * (w / 2) + (h / 2) * (h / 2));
    const absOffset = Math.abs(offset);
    const bouncePeriod = 2 * maxDist;
    const phase = absOffset % bouncePeriod;
    const triangle = phase < maxDist ? phase : bouncePeriod - phase;

    // Re-derive offsetX and offsetY from the clamped distance
    const totalAbs = Math.abs(offset);
    if (totalAbs > 0.001) {
      const clampedDist = Math.sign(offset) * triangle;
      const ratio = clampedDist / offset;
      offsetX = offsetX * ratio;
      offsetY = offsetY * ratio;
    }
    // No modulo needed; pixels outside bounds are clipped
  }

  // Convert to integer offsets for pixel-level shifting
  const shiftX = Math.round(offsetX);
  const shiftY = Math.round(offsetY);

  if (shiftX === 0 && shiftY === 0) return pixels;

  // Build the result pixel grid
  const result: PixelGrid = emptyGrid(h, w);

  // Apply offset with wrap-around or clipping
  const useWrap = scrollMode === 'loop' || scrollMode === 'bounce_loop';

  // Efficient horizontal shift: for each row, copy with offset
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcColor = pixels[y][x];
      if (srcColor === null) continue;

      // Compute source position (we're mapping from source to destination)
      // dest = source + shift, so source = dest - shift
      // We iterate over source and write to dest
      let destX = x + shiftX;
      let destY = y + shiftY;

      if (useWrap) {
        // Wrap-around
        destX = ((destX % w) + w) % w;
        destY = ((destY % h) + h) % h;
      } else {
        // Clip out-of-bounds
        if (destX < 0 || destX >= w || destY < 0 || destY >= h) continue;
      }

      // Handle auto_edge_blend for seamless mode
      if (seamlessMode === 'auto_edge_blend' && useWrap) {
        // Near-boundary blending: when the shifted pixel is near the edge
        // where the seam would be visible, blend with the opposite edge pixel
        const blendZone = 2; // pixels near boundary to blend
        // Check if this pixel's destination is near a seam boundary
        // Seam occurs where pixels wrap from one edge to another
        // The seam position is where shiftX wraps around
        if (scrollDirection === 'horizontal' || scrollDirection === 'diagonal') {
          const seamX = ((w - shiftX) % w + w) % w;
          const distToSeam = Math.min(Math.abs(destX - seamX), w - Math.abs(destX - seamX));
          if (distToSeam < blendZone && blendZone > 0) {
            const blendFactor = distToSeam / blendZone;
            const oppositeSrcX = ((x - shiftX) % w + w) % w;
            const oppositeColor = pixels[y][oppositeSrcX];
            if (oppositeColor !== null) {
              result[destY][destX] = lerpColor(oppositeColor, srcColor, blendFactor);
              continue;
            }
          }
        }
        if (scrollDirection === 'vertical' || scrollDirection === 'diagonal') {
          const seamY = ((h - shiftY) % h + h) % h;
          const distToSeam = Math.min(Math.abs(destY - seamY), h - Math.abs(destY - seamY));
          if (distToSeam < blendZone && blendZone > 0) {
            const blendFactor = distToSeam / blendZone;
            const oppositeSrcY = ((y - shiftY) % h + h) % h;
            const oppositeColor = pixels[oppositeSrcY][x];
            if (oppositeColor !== null) {
              result[destY][destX] = lerpColor(oppositeColor, srcColor, blendFactor);
              continue;
            }
          }
        }
      }

      result[destY][destX] = srcColor;
    }
  }

  return result;
}
