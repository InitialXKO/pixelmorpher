// ============================================================
// 修补 Pattern：7 种像素级修补算法
// 用于填充遮罩提取后留下的空洞
// ============================================================

import type { PixelGrid, PixelColor } from './types';
import { inpaintPixels } from './inpainting';

/** 空像素判断 */
const isEmpty = (c: PixelColor) => !c || c === '';

/** 获取包围盒内所有空洞像素坐标 */
function findHoles(pixels: PixelGrid): [number, number][] {
  const holes: [number, number][] = [];
  for (let y = 0; y < pixels.length; y++) {
    for (let x = 0; x < pixels[y].length; x++) {
      if (isEmpty(pixels[y][x])) holes.push([x, y]);
    }
  }
  return holes;
}

/** 获取空洞边缘的颜色（非空邻居） */
function getBoundaryColors(pixels: PixelGrid, holes: [number, number][]): string[] {
  const colors: string[] = [];
  const h = pixels.length;
  const w = pixels[0]?.length ?? 0;
  const holeSet = new Set(holes.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of holes) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (holeSet.has(`${nx},${ny}`)) continue;
        const c = pixels[ny][nx];
        if (!isEmpty(c)) colors.push(c as string);
      }
    }
  }
  return colors;
}

/** 1. AI 修复（Telea）：快速行进求距离场，逐格以一阶外推填补空洞
 * （inpaintPixels 即 Telea 2004 原算法，线条/渐变可顺梯度接进空洞） */
export function patternModeFill(pixels: PixelGrid): PixelGrid {
  const holes = findHoles(pixels);
  if (holes.length === 0) return pixels.map(row => [...row]);
  const mask = new Set(holes.map(([x, y]) => `${x},${y}`));
  return inpaintPixels(pixels, mask, 3);
}

/** 2. AI 修复（Telea·大半径）：同 Telea 算法，邻域半径 5（缺省 3） */
export function patternEdgeExtend(pixels: PixelGrid): PixelGrid {
  const holes = findHoles(pixels);
  if (holes.length === 0) return pixels.map(row => [...row]);
  const mask = new Set(holes.map(([x, y]) => `${x},${y}`));
  return inpaintPixels(pixels, mask, 5);
}

/** 3. Bayer 抖动：两种主色按 4x4 Bayer 矩阵抖动 */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];


export const REPAIR_PATTERNS = [
  { id: 'mode', label: 'Telea 填补', fn: patternModeFill },
  { id: 'edge', label: 'Telea 填补·大半径', fn: patternEdgeExtend },
] as const;
