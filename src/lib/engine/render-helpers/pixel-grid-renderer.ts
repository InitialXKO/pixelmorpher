/**
 * Helper: render a PixelGrid to an offscreen canvas using ImageData.
 * Extracted from createPartCanvasInner to reduce cyclomatic complexity.
 *
 * Uses the canvas pool for allocation and builds ImageData directly
 * to avoid per-pixel fillRect calls.
 */

import type { PixelGrid } from '../../types';
import { hexToRgbCached } from '../color-utils';
import { acquireCanvas } from '../canvas-pool';

/**
 * Render a PixelGrid to a pool-allocated HTMLCanvasElement.
 * Returns the canvas (caller is responsible for releasing it via releaseCanvas).
 */
export function renderPixelGridToCanvas(
  pixels: PixelGrid,
  fallbackWidth: number,
  fallbackHeight: number,
): HTMLCanvasElement {
  const canvasW = pixels[0]?.length || fallbackWidth;
  const canvasH = pixels.length || fallbackHeight;

  const canvas = acquireCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Build ImageData directly — avoids ~32K fillRect calls per 256×256 part
  const imageData = ctx.createImageData(canvasW, canvasH);
  const data = imageData.data;
  for (let y = 0; y < canvasH; y++) {
    const row = pixels[y];
    if (!row) continue;
    const rowOff = y * canvasW * 4;
    for (let x = 0; x < canvasW; x++) {
      const color = row[x];
      if (color) {
        const packed = hexToRgbCached(color);
        const idx = rowOff + x * 4;
        data[idx]     = (packed >> 16) & 0xFF;
        data[idx + 1] = (packed >> 8) & 0xFF;
        data[idx + 2] = packed & 0xFF;
        data[idx + 3] = 255;
      }
      // null pixels stay (0,0,0,0) — transparent
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}
