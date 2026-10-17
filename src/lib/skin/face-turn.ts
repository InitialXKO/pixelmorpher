// ============================================================
// PixelMorpher - Face Turn (Spine-style pseudo-3D head turning)
// ============================================================
// 蒙皮转面：用单张静态图 + 网格变形，模拟转头/转身的伪 3D 效果，
// 不用画多角度差分。
//
// 原理（像素级透视近似）：
// - yaw（左右转）：每个像素按到中心线的水平距离算位移，
//   离中心越远位移越大，模拟透视。鼻子等凸起处额外增强。
// - pitch（上下转）：同理作用于 Y 轴。
// - 本质是水平/垂直挤压 + 特征点偏移，观众脑补成"转过去了"。
//
// 与 mesh-skin.ts 的关系：
// - mesh-skin 是关节蒙皮（子节点相对父节点旋转时的接缝变形）
// - face-turn 是整体转面（单个精灵内部的伪 3D 转头）
// - 渲染顺序：先转面（整体），后关节蒙皮（局部）

import type { PixelGrid, PixelColor } from '../unified-types';
import { rgbToHex } from '../engine/utils';
import { hexToRgb } from '../engine/color-utils';

export interface FaceTurnParams {
  /** 左右转：-1（左）~ 1（右），0=无 */
  yaw: number;
  /** 上下转：-1（上）~ 1（下），0=无 */
  pitch: number;
  /** 转轴中心 X（像素），默认精灵中心 */
  centerX?: number;
  /** 转轴中心 Y（像素），默认精灵中心 */
  centerY?: number;
  /** 透视强度系数，默认 0.3 */
  perspective?: number;
  /** 深度增强：凸起处（如鼻子）的额外位移倍数，默认 1.5 */
  depthBoost?: number;
  /** 手动标注的特征点（相对坐标 0~1）；有则优先用鼻子位置替代亮度启发式 */
  landmarks?: import('../unified-types').SpriteLandmarks;
}

function isTransparent(p: PixelColor): boolean {
  return p === null || p === undefined;
}

function parseColor(p: PixelColor): { r: number; g: number; b: number } | null {
  if (isTransparent(p)) return null;
  try {
    const [r, g, b] = hexToRgb(p as string);
    return { r, g, b };
  } catch {
    return null;
  }
}

/**
 * 对精灵像素应用转面变形（伪 3D 转头）。
 *
 * @param pixels - 精灵原始像素（PixelGrid，不会被修改）
 * @param params - 转面参数（yaw/pitch/中心/强度）
 * @returns 新的 PixelGrid（变形后）
 */
export function applyFaceTurn(
  pixels: PixelGrid,
  params: FaceTurnParams,
): PixelGrid {
  const height = pixels.length;
  const width = height > 0 ? pixels[0].length : 0;
  if (width === 0 || height === 0) return pixels;

  const { yaw, pitch } = params;
  // 角度太小无需变形
  if (Math.abs(yaw) < 1e-6 && Math.abs(pitch) < 1e-6) return pixels;

  const cx = params.centerX ?? width / 2;
  const cy = params.centerY ?? height / 2;
  const k = params.perspective ?? 0.3;
  const depthBoost = params.depthBoost ?? 1.5;
  const landmarks = params.landmarks;

  // 手动标注：鼻子像素位置（有标注时替代亮度启发式）
  const nosePx = landmarks?.nose
    ? { x: landmarks.nose.x * width, y: landmarks.nose.y * height }
    : null;
  // 眼睛位置（用于不对称权重：转右时左眼侧压缩更多）
  const eyeLPx = landmarks?.leftEye
    ? { x: landmarks.leftEye.x * width, y: landmarks.leftEye.y * height }
    : null;
  const eyeRPx = landmarks?.rightEye
    ? { x: landmarks.rightEye.x * width, y: landmarks.rightEye.y * height }
    : null;
  // 鼻子影响半径（像素）：标注模式下按精灵尺寸自适应
  const noseRadius = Math.max(2, Math.min(width, height) * 0.15);

  const result: PixelGrid = pixels.map(row => [...row]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const orig = pixels[y][x];
      if (isTransparent(orig)) continue;

      // 到中心线的归一化距离（-1~1）
      const nx = (x - cx) / (width / 2);
      const ny = (y - cy) / (height / 2);

      // 基础位移：离中心越远，yaw/pitch 引起的位移越大（透视近似）
      // yaw>0（右转）：右侧像素向右移，左侧向左移 → 挤压感
      // 同时整体向右偏移，模拟脸部朝向
      let dx = yaw * nx * width * k * 0.5;
      let dy = pitch * ny * height * k * 0.5;

      if (nosePx) {
        // ---- 手动标注模式 ----
        // 鼻子：按到鼻子标注点的距离算深度权重，越近位移越大
        const dNose = Math.hypot(x - nosePx.x, y - nosePx.y);
        if (dNose < noseRadius) {
          const w = 1 - dNose / noseRadius; // 0~1，鼻子中心最强
          const boost = w * (depthBoost - 1);
          dx += yaw * boost * width * 0.08;
          dy += pitch * boost * height * 0.08;
        }
        // 眼睛不对称：转右（yaw>0）时，左眼侧（x < cx）压缩更多；
        // 转左时反之。用眼睛位置确定"远侧"，增强其位移。
        if (eyeLPx && eyeRPx && Math.abs(yaw) > 1e-6) {
          // 远侧眼睛：yaw>0 时是左眼，yaw<0 时是右眼
          const farEye = yaw > 0 ? eyeLPx : eyeRPx;
          const dEye = Math.hypot(x - farEye.x, y - farEye.y);
          const eyeRadius = noseRadius * 0.8;
          if (dEye < eyeRadius) {
            const w = (1 - dEye / eyeRadius) * 0.5;
            // 远侧向转面方向"跟进"，制造不对称挤压
            dx += yaw * w * width * 0.04;
          }
        }
      } else {
        // ---- 亮度启发式（无标注时回退，保持兼容） ----
        // 亮度高的像素视为凸起（如鼻子高光），额外增强位移
        const c = parseColor(orig);
        if (c) {
          const brightness = (c.r + c.g + c.b) / 3 / 255;
          // 亮度 > 0.7 视为高光/凸起
          if (brightness > 0.7) {
            const boost = (brightness - 0.7) / 0.3 * (depthBoost - 1);
            dx += yaw * boost * width * 0.05;
            dy += pitch * boost * height * 0.05;
          }
        }
      }

      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;

      // 反向采样：目标像素 (x,y) 从源 (x-dx, y-dy) 取值
      const sx = x - dx;
      const sy = y - dy;

      const sampled = bilinearSample(pixels, sx, sy, width, height);
      if (!isTransparent(sampled)) {
        result[y][x] = sampled;
      }
      // 采样透明则保留原像素（防镂空）
    }
  }

  return result;
}

function bilinearSample(
  pixels: PixelGrid,
  x: number,
  y: number,
  width: number,
  height: number,
): PixelColor {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;

  const p00 = getPixel(pixels, x0, y0, width, height);
  const p10 = getPixel(pixels, x1, y0, width, height);
  const p01 = getPixel(pixels, x0, y1, width, height);
  const p11 = getPixel(pixels, x1, y1, width, height);

  const c00 = parseColor(p00);
  const c10 = parseColor(p10);
  const c01 = parseColor(p01);
  const c11 = parseColor(p11);

  // 全透明 → 透明
  if (!c00 && !c10 && !c01 && !c11) return null;

  // 双线性插值（跳过透明角，避免黑边污染）
  let r = 0, g = 0, b = 0, wSum = 0;
  const corners: Array<[{ r: number; g: number; b: number } | null, number]> = [
    [c00, (1 - fx) * (1 - fy)],
    [c10, fx * (1 - fy)],
    [c01, (1 - fx) * fy],
    [c11, fx * fy],
  ];
  for (const [c, w] of corners) {
    if (!c) continue;
    r += c.r * w;
    g += c.g * w;
    b += c.b * w;
    wSum += w;
  }
  if (wSum <= 0) return null;
  return rgbToHex(r / wSum, g / wSum, b / wSum);
}

function getPixel(
  pixels: PixelGrid,
  x: number,
  y: number,
  width: number,
  height: number,
): PixelColor {
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return pixels[y][x] ?? null;
}

/**
 * 从连续 facingAngle（0~360）计算相邻两离散方向及混合系数。
 *
 * 8 方向：每 45° 一个方向（0=0°, 1=45°, ..., 7=315°）。
 *
 * @returns { dirA, dirB, blend } dirA/B 为 DirectionIndex（0-7），
 *          blend 为 0~1（0=完全 dirA，1=完全 dirB）
 */
export function facingAngleToBlend(
  facingAngle: number,
): { dirA: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; dirB: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; blend: number } {
  // 归一化到 [0, 360)
  let a = ((facingAngle % 360) + 360) % 360;
  const sector = a / 45; // 0~8
  const dirA = Math.floor(sector) % 8 as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const dirB = (dirA + 1) % 8 as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const blend = sector - Math.floor(sector); // 0~1
  return { dirA, dirB, blend };
}

/**
 * Alpha 混合两个 PixelGrid（同尺寸）。
 * 用于方向间过渡：两方向精灵各做 faceTurn 后按 blend 混合。
 */
export function alphaBlendGrids(
  gridA: PixelGrid,
  gridB: PixelGrid,
  blend: number, // 0=全 A，1=全 B
): PixelGrid {
  const height = Math.max(gridA.length, gridB.length);
  const width = Math.max(
    gridA.length > 0 ? gridA[0].length : 0,
    gridB.length > 0 ? gridB[0].length : 0,
  );
  const result: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < width; x++) {
      const pa = y < gridA.length && x < (gridA[y]?.length ?? 0) ? gridA[y][x] : null;
      const pb = y < gridB.length && x < (gridB[y]?.length ?? 0) ? gridB[y][x] : null;
      if (isTransparent(pa) && isTransparent(pb)) {
        row.push(null);
        continue;
      }
      if (isTransparent(pa)) { row.push(pb); continue; }
      if (isTransparent(pb)) { row.push(pa); continue; }
      // 双方都不透明：按 blend 插值 RGB
      const ca = parseColor(pa)!;
      const cb = parseColor(pb)!;
      const r = Math.round(ca.r + (cb.r - ca.r) * blend);
      const g = Math.round(ca.g + (cb.g - ca.g) * blend);
      const b = Math.round(ca.b + (cb.b - ca.b) * blend);
      row.push(rgbToHex(r, g, b));
    }
    result.push(row);
  }
  return result;
}
