// ============================================================
// PixelMorpher - Bayer Dithering Matrices & applyDither
// ============================================================

import type { PixelGrid } from '../types';
import { hexBrightness } from './color-utils';

const BAYER_2X2 = [
  [0, 2],
  [3, 1],
];

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const BAYER_8X8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

const BAYER_MATRICES: Record<string, number[][]> = {
  bayer2: BAYER_2X2,
  bayer4: BAYER_4X4,
  bayer8: BAYER_8X8,
};

/** Apply ordered dithering using a Bayer matrix */
export function applyDither(pixels: PixelGrid, pattern: string): PixelGrid {
  const bayer = BAYER_MATRICES[pattern] || BAYER_4X4;
  const size = bayer.length;
  const maxVal = size * size;
  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  const result: PixelGrid = Array.from({ length: h }, () => Array(w).fill(null));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = pixels[y][x];
      if (!color) continue;
      const brightness = hexBrightness(color);
      const threshold = bayer[y % size][x % size] / maxVal;
      if (brightness >= threshold) {
        result[y][x] = color;
      }
    }
  }
  return result;
}
