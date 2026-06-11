// ============================================================
// PixelMorpher - Utility Functions
// floodFill, pixelGridToImageData, imageDataToPixelGrid
// ============================================================

import type { PixelGrid, PixelColor } from '../types';
import { hexToRgbCached } from './color-utils';

// ============================================================
// RGBA → Hex Conversion (shared across codebase)
// ============================================================

/** Minimum alpha threshold to consider a pixel visible (below → null/transparent) */
const ALPHA_THRESHOLD = 10;

/**
 * Convert RGBA values to a hex color string or null if transparent.
 * Used by imageDataToPixelGrid and all ImageData→PixelGrid conversion sites.
 *
 * @param r Red channel (0-255)
 * @param g Green channel (0-255)
 * @param b Blue channel (0-255)
 * @param a Alpha channel (0-255)
 * @returns Hex color string like '#rrggbb' or null if alpha < 10
 */
export function rgbaToHexOrNull(r: number, g: number, b: number, a: number): string | null {
  if (a < ALPHA_THRESHOLD) return null;
  return rgbToHex(r, g, b);
}

/**
 * Convert RGB values to a hex color string.
 * Values are clamped to 0-255 and rounded before conversion.
 * Shared across the codebase — replaces all local rgbToHex implementations.
 *
 * @param r Red channel (clamped to 0-255, rounded)
 * @param g Green channel (clamped to 0-255, rounded)
 * @param b Blue channel (clamped to 0-255, rounded)
 * @returns Hex color string like '#rrggbb'
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const ri = Math.max(0, Math.min(255, Math.round(r)));
  const gi = Math.max(0, Math.min(255, Math.round(g)));
  const bi = Math.max(0, Math.min(255, Math.round(b)));
  return `#${ri.toString(16).padStart(2, '0')}${gi.toString(16).padStart(2, '0')}${bi.toString(16).padStart(2, '0')}`;
}

// ============================================================
// Export Helpers
// ============================================================

/**
 * Convert pixel grid to ImageData for export
 */
function pixelGridToImageData(pixels: PixelGrid, width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = pixels[y];
    if (!row) continue;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const color = row[x];
      if (color) {
        const packed = hexToRgbCached(color);
        data[i] = (packed >> 16) & 0xFF;
        data[i + 1] = (packed >> 8) & 0xFF;
        data[i + 2] = packed & 0xFF;
        data[i + 3] = 255;
      } else {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      }
    }
  }
  return new ImageData(data, width, height);
}

/**
 * Convert ImageData to PixelGrid
 */
export function imageDataToPixelGrid(imageData: ImageData): PixelGrid {
  const { width, height, data } = imageData;
  const pixels: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      row.push(rgbaToHexOrNull(r, g, b, a));
    }
    pixels.push(row);
  }
  return pixels;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Flood fill algorithm for pixel grid
 */
export function floodFill(
  pixels: PixelGrid,
  startX: number,
  startY: number,
  fillColor: string
): PixelGrid {
  const height = pixels.length;
  const width = pixels[0]?.length || 0;
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return pixels;

  const targetColor = pixels[startY][startX];
  if (targetColor === fillColor) return pixels;

  const result = pixels.map((row) => [...row]);
  const stack: [number, number][] = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (result[y][x] !== targetColor) continue;

    result[y][x] = fillColor;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return result;
}
