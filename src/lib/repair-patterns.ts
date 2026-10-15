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

/** 1. AI 修复（Telea）：用 inpainting 算法智能填补空洞
 * 替代原众数填充的简单平涂，按边界加权平均自然过渡 */
export function patternModeFill(pixels: PixelGrid): PixelGrid {
  const holes = findHoles(pixels);
  if (holes.length === 0) return pixels.map(row => [...row]);
  const mask = new Set(holes.map(([x, y]) => `${x},${y}`));
  return inpaintPixels(pixels, mask, 3);
}

/** 2. AI 修复（Telea）：替代原简单最近邻，边界加权平均 */
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

export function patternBayerDither(pixels: PixelGrid): PixelGrid {
  const result = pixels.map(row => [...row]);
  const holes = findHoles(pixels);
  if (holes.length === 0) return result;
  const colors = getBoundaryColors(pixels, holes);
  if (colors.length === 0) return result;
  // 取前两种主色
  const freq = new Map<string, number>();
  for (const c of colors) freq.set(c, (freq.get(c) ?? 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const c1 = sorted[0][0];
  const c2 = sorted[1]?.[0] ?? c1;
  for (const [x, y] of holes) {
    const threshold = BAYER_4X4[y % 4][x % 4] / 16;
    // 按边界颜色比例决定阈值（简化：50%）
    result[y][x] = threshold < 0.5 ? c1 : c2;
  }
  return result;
}

/** 4. 噪点纹理：主色 + 10% 深色噪点 */
export function patternNoiseTexture(pixels: PixelGrid): PixelGrid {
  const result = pixels.map(row => [...row]);
  const holes = findHoles(pixels);
  if (holes.length === 0) return result;
  const colors = getBoundaryColors(pixels, holes);
  if (colors.length === 0) return result;
  const freq = new Map<string, number>();
  for (const c of colors) freq.set(c, (freq.get(c) ?? 0) + 1);
  const main = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  // 深色：主色变暗 30%
  const darken = (hex: string): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const f = 0.7;
    return `#${((1 << 24) + (Math.round(r * f) << 16) + (Math.round(g * f) << 8) + Math.round(b * f)).toString(16).slice(1)}`;
  };
  const dark = darken(main);
  for (const [x, y] of holes) {
    result[y][x] = Math.random() < 0.1 ? dark : main;
  }
  return result;
}

/** 5. 镜像复制：以空洞包围盒中心为轴镜像 */
export function patternMirror(pixels: PixelGrid, axis: 'h' | 'v' = 'v'): PixelGrid {
  const result = pixels.map(row => [...row]);
  const holes = findHoles(pixels);
  if (holes.length === 0) return result;
  // 找包围盒
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of holes) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const h = pixels.length;
  const w = pixels[0]?.length ?? 0;
  for (const [x, y] of holes) {
    const mx = axis === 'v' ? Math.round(2 * cx - x) : x;
    const my = axis === 'h' ? Math.round(2 * cy - y) : y;
    if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
    const c = pixels[my][mx];
    if (!isEmpty(c)) result[y][x] = c;
  }
  return result;
}

/** 7. 方向延伸：沿指定向量涂抹边缘像素 */
export function patternDirectional(
  pixels: PixelGrid,
  dx: number,
  dy: number
): PixelGrid {
  const result = pixels.map(row => [...row]);
  const h = pixels.length;
  const w = pixels[0]?.length ?? 0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return result;
  const nx = dx / len;
  const ny = dy / len;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isEmpty(result[y][x])) continue;
      // 沿反方向找第一个非空像素
      let found = '';
      for (let t = 1; t < Math.max(w, h); t++) {
        const sx = Math.round(x - nx * t);
        const sy = Math.round(y - ny * t);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
        const c = pixels[sy][sx];
        if (!isEmpty(c)) { found = c as string; break; }
      }
      if (found) result[y][x] = found;
    }
  }
  return result;
}

// Pattern 注册表（6 为仿制图章，需手动操作，不在此）
export const REPAIR_PATTERNS = [
  { id: 'mode', label: 'AI 修复', fn: patternModeFill },
  { id: 'edge', label: 'AI 修复·大半径', fn: patternEdgeExtend },
  { id: 'bayer', label: 'Bayer 抖动', fn: patternBayerDither },
  { id: 'noise', label: '噪点纹理', fn: patternNoiseTexture },
  { id: 'mirror-v', label: '镜像·垂直', fn: (p: PixelGrid) => patternMirror(p, 'v') },
  { id: 'mirror-h', label: '镜像·水平', fn: (p: PixelGrid) => patternMirror(p, 'h') },
  { id: 'directional', label: '方向延伸', fn: null }, // 需用户指定方向，面板特殊处理
] as const;
