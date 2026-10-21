// ============================================================
// PixelMorpher - Mesh Skinning for Joint Sockets
// ============================================================
// 网格蒙皮模式：子节点在关节处旋转时，不用关节盘遮盖接缝，
// 而是对子精灵在关节附近的像素做插值变形，让接缝平滑过渡。
//
// 原理（2D 简化版双四元数蒙皮）：
// - 子精灵整体按子节点世界变换渲染（刚性旋转 jointAngle）
// - 离 plug 越近的像素，越"滞后"于旋转（counter-rotate 回来）
// - plug 处 (w=1)：完全对齐父节点方向；影响半径边缘 (w=0)：完全跟随子节点
// - 中间按 smoothstep/linear 插值，形成平滑弯曲

import type { PixelGrid, PixelColor } from '../unified-types';
import { rgbToHex } from '../engine/utils';
import { hexToRgb } from '../engine/color-utils';

export type SkinCurve = 'linear' | 'smoothstep';

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
 * 对精灵像素应用关节网格蒙皮变形。
 *
 * @param pixels - 精灵原始像素（PixelGrid，不会被修改）
 * @param plugX - plug 在精灵局部坐标（像素，x）
 * @param plugY - plug 在精灵局部坐标（像素，y）
 * @param jointAngle - 关节相对角度（度，子相对父；0=无旋转）
 * @param radius - 影响半径（像素）
 * @param curve - 混合曲线
 * @returns 新的 PixelGrid（变形后）
 */
export function applyMeshSkin(
  pixels: PixelGrid,
  plugX: number,
  plugY: number,
  jointAngle: number,
  radius: number,
  curve: SkinCurve = 'smoothstep',
): PixelGrid {
  const height = pixels.length;
  const width = height > 0 ? pixels[0].length : 0;
  if (width === 0 || height === 0 || radius <= 0) return pixels;

  // 角度太小无需变形（避免浮点噪声）
  const angleRad = (jointAngle * Math.PI) / 180;
  if (Math.abs(angleRad) < 1e-6) return pixels;

  const result: PixelGrid = pixels.map(row => [...row]);
  const r2 = radius * radius;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - plugX;
      const dy = y - plugY;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;

      const d = Math.sqrt(d2);
      let w = 1 - d / radius; // 1@plug → 0@边缘
      if (curve === 'smoothstep') {
        w = w * w * (3 - 2 * w);
      }
      if (w <= 0) continue;

      // Counter-rotation：把采样点绕 plug 反向旋转 jointAngle * w，
      // 让关节附近像素"滞后"，形成弯曲。
      // w=1（plug 处）：采样点转回 -jointAngle，视觉上对齐父方向
      // w=0（边缘）：不转，跟随子节点
      const back = -angleRad * w;
      const cosB = Math.cos(back);
      const sinB = Math.sin(back);
      const sx = plugX + dx * cosB - dy * sinB;
      const sy = plugY + dx * sinB + dy * cosB;

      const sampled = bilinearSample(pixels, sx, sy, width, height);
      if (!isTransparent(sampled)) {
        result[y][x] = sampled;
      }
      // 若采样透明：保留原像素（result 已是拷贝，不覆盖）
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
 * 蒙皮快照弯曲：对「父+子合并精灵」做关节弯曲变形。
 *
 * 合并精灵冻结的是快照姿态；当前子相对父的角变化 deltaAngle 时：
 * - 沿子肢体轴向（axis）投影 t ≤ −radius 的像素（父侧）不动
 * - t ≥ +radius 的像素（子侧）绕关节刚性旋转 deltaAngle
 * - 带内按 curve 平滑过渡（每像素按其权重 w 旋转 deltaAngle·w）
 * 逆映射采样，但权重 w 必须按源像素的轴向投影算（正向映射的定义），
 * 故对每个输出像素迭代求一致解 s = R(−delta·w(s))·(p − J)（迭代后正向验证，
 * 折叠区无原像判透明；若按输出像素的投影取 w，肢体转 90° 后落点投影
 * 归零、权重全错位、肢体消失）。
 * 采样透明 → 输出透明（与 applyMeshSkin 不同：那里精灵本体仍在渲染，保留原像素
 * 防撕裂；这里整条肢体转走后原位必须清空，否则留下快照姿势的残影）。
 *
 * @param pixels - 合并精灵像素（不修改）
 * @param jointX/jointY - 关节在精灵局部坐标（像素）
 * @param axisX/axisY - 子肢体轴向单位向量（精灵局部，y-down）
 * @param deltaAngle - 相对快照的角变化（度）
 * @param radius - 弯曲带半径（像素，沿轴向 ±radius）
 */
export function applySnapshotBend(
  pixels: PixelGrid,
  jointX: number,
  jointY: number,
  axisX: number,
  axisY: number,
  deltaAngle: number,
  radius: number,
  curve: SkinCurve = 'smoothstep',
): PixelGrid {
  const height = pixels.length;
  const width = height > 0 ? pixels[0].length : 0;
  if (width === 0 || height === 0 || radius <= 0) return pixels;
  const angleRad = (deltaAngle * Math.PI) / 180;
  if (Math.abs(angleRad) < 1e-6) return pixels;

  // 垂直门控走廊（带内横向衰减）：仅轴向权重是一条无限宽的「板」，宽父件
  // （躯干）在关节轴高处的像素会被整片带走（实测 δ=60°/r=12 时离轴 16px 处
  // 位移 ≈9.5px）。走廊从精灵自身量：子侧带外半段（t∈[radius/2, radius]）
  // 不透明像素的垂直跨度——即肢体离开过渡带时的出口宽度（含衣物；取这段是
  // 因为 t≈0 处有父件自身的截面、会把走廊污染成父件宽度，且出口宽度正是
  // 与刚性区连续所必需的门控宽度）。带内（t<radius）权重乘门控（走廊内 1、
  // 向外 smoothstep 到 0，外沿 = 内沿×1.25+2px）；子侧刚性区（t≥radius）
  // 不门控、整宽同转。量不到（该段无像素）则不门控。
  let corridorInner: number | null = null;
  {
    let maxU = 0;
    let found = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isTransparent(pixels[y][x])) continue;
        const dx = x - jointX;
        const dy = y - jointY;
        const t = dx * axisX + dy * axisY;
        if (t < radius / 2 || t > radius) continue;
        const u = Math.abs(-dx * axisY + dy * axisX);
        if (u > maxU) maxU = u;
        found = true;
      }
    }
    if (found) corridorInner = maxU;
  }
  const corridorOuter = corridorInner !== null ? corridorInner * 1.25 + 2 : 0;
  const gateAt = (u: number): number => {
    if (corridorInner === null) return 1;
    const a = Math.abs(u);
    if (a <= corridorInner) return 1;
    if (a >= corridorOuter) return 0;
    const s = (a - corridorInner) / (corridorOuter - corridorInner);
    return 1 - s * s * (3 - 2 * s);
  };
  const weightAt = (sx: number, sy: number): number => {
    const t = sx * axisX + sy * axisY;
    let w = (t + radius) / (2 * radius);
    if (w < 0) w = 0;
    if (w > 1) w = 1;
    if (curve === 'smoothstep') w = w * w * (3 - 2 * w);
    if (w > 0 && t < radius) {
      w *= gateAt(-sx * axisY + sy * axisX);
    }
    return w;
  };
  // 迭代求源点 s = R(−delta·w(s))·(p−J)。变形可折叠，同一输出像素可能有
  // 多个自洽原像（静止材料自身 + 转入的空位/材料），故双初值各解一次：
  // 全旋转初值（刚性支）与恒等初值（静止支）；各自正向验证（R(+delta·w(s))·s
  // 与 (p−J) 偏差 ≤1.5px 才有效），优先取采样到不透明像素的候选，
  // 两者都不透明时取刚性支（移动材料盖静止材料）；都无效 → 无原像 → 透明。
  const result: PixelGrid = pixels.map((row) => [...row]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - jointX;
      const dy = y - jointY;
      const solveFrom = (ix: number, iy: number) => {
        let sx = ix;
        let sy = iy;
        for (let it = 0; it < 4; it++) {
          const w = weightAt(sx, sy);
          const back = -angleRad * w;
          const cosB = Math.cos(back);
          const sinB = Math.sin(back);
          sx = dx * cosB - dy * sinB;
          sy = dx * sinB + dy * cosB;
        }
        const wF = weightAt(sx, sy);
        const fwd = angleRad * wF;
        const fx = sx * Math.cos(fwd) - sy * Math.sin(fwd);
        const fy = sx * Math.sin(fwd) + sy * Math.cos(fwd);
        return { sx, sy, valid: Math.hypot(fx - dx, fy - dy) <= 1.5 };
      };
      const rigid = solveFrom(
        dx * Math.cos(angleRad) + dy * Math.sin(angleRad),
        -dx * Math.sin(angleRad) + dy * Math.cos(angleRad),
      );
      const still = solveFrom(dx, dy);
      let chosen: { sx: number; sy: number; valid: boolean } | null = null;
      for (const cand of [rigid, still]) {
        if (!cand.valid) continue;
        const s = bilinearSample(pixels, jointX + cand.sx, jointY + cand.sy, width, height);
        if (!isTransparent(s)) {
          chosen = cand;
          break;
        }
        if (!chosen) chosen = cand; // 先留第一个有效候选（可能采样透明）
      }
      result[y][x] = chosen
        ? bilinearSample(pixels, jointX + chosen.sx, jointY + chosen.sy, width, height)
        : null;
    }
  }
  return result;
}
