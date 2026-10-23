// ============================================================
// PixelMorpher - 精灵像素变换（纯函数，无 DOM 依赖）
//
// 坐标约定：连续坐标 X 向右、Y 向下，精灵占据 [0,w]×[0,h]，
// 像素 (x,y) 的中心在 (x+0.5, y+0.5)。
//
// 两族变换：
// - D4 置换族（无损）：90° 步进旋转 + 水平/垂直/双对角镜像，共 7 个非恒等
//   操作。plug/heightmap/landmarks 全部精确映射。
// - 任意仿射族（重采样）：任意角旋转、任意轴镜像，矩阵绕锚点（plug）构造，
//   像素经 bakeCanvasAffine 以 4× 超采样烘焙（与主渲染同口径），
//   heightmap/landmarks 在本模块按同一几何映射。
// 路由：旋转角为 90° 倍数、镜像轴为 45° 倍数时自动落到 D4 无损路径。
// ============================================================

import { applyAffine, invertAffine } from './engine/affine';
import type { Affine2D } from './engine/affine';
import type { SpriteLandmarks } from './unified-types';

export type D4Op =
  | 'rot90' // 顺时针 90°（屏幕视角，Y 向下）
  | 'rot180'
  | 'rot270' // 逆时针 90°
  | 'flipH' // 左右镜像（竖直轴）
  | 'flipV' // 上下镜像（水平轴）
  | 'transpose' // 主对角（\）翻转
  | 'antiTranspose'; // 副对角（/）翻转

export type SpriteTransformRequest =
  | { kind: 'd4'; op: D4Op }
  | { kind: 'rotate'; angleDeg: number }
  | { kind: 'mirrorAxis'; axisDeg: number };

export interface D4Mapped {
  x: number;
  y: number;
  /** 变换后画布宽 */
  w: number;
  /** 变换后画布高 */
  h: number;
}

/** D4 连续坐标映射：点 (x,y)（源 w×h 空间）→ 目标空间坐标 + 目标尺寸。 */
export function d4MapPoint(op: D4Op, x: number, y: number, w: number, h: number): D4Mapped {
  switch (op) {
    case 'rot90': return { x: h - y, y: x, w: h, h: w };
    case 'rot180': return { x: w - x, y: h - y, w, h };
    case 'rot270': return { x: y, y: w - x, w: h, h: w };
    case 'flipH': return { x: w - x, y, w, h };
    case 'flipV': return { x, y: h - y, w, h };
    case 'transpose': return { x: y, y: x, w: h, h: w };
    case 'antiTranspose': return { x: h - y, y: w - x, w: h, h: w };
  }
}

/** D4 置换任意网格（像素网格 fill=null、heightmap fill=0 共用）。 */
export function d4TransformGrid<T>(grid: T[][], op: D4Op, fill: T): T[][] {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const dims = d4MapPoint(op, 0, 0, w, h);
  const out: T[][] = Array.from({ length: dims.h }, () => Array(dims.w).fill(fill));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = d4MapPoint(op, x + 0.5, y + 0.5, w, h);
      out[Math.floor(p.y)]![Math.floor(p.x)] = grid[y]![x]!;
    }
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function remapLandmarks(
  lm: SpriteLandmarks,
  mapAbs: (ax: number, ay: number) => { x: number; y: number },
): SpriteLandmarks {
  const map = (p?: { x: number; y: number }) => {
    if (!p) return undefined;
    const r = mapAbs(p.x, p.y);
    return { x: clamp01(r.x), y: clamp01(r.y) };
  };
  return {
    leftEye: map(lm.leftEye),
    rightEye: map(lm.rightEye),
    nose: map(lm.nose),
    mouth: map(lm.mouth),
  };
}

/** D4 下的 landmarks 重映射（输入/输出均为相对 0..1 坐标）。 */
export function d4TransformLandmarks(lm: SpriteLandmarks, op: D4Op, w: number, h: number): SpriteLandmarks {
  return remapLandmarks(lm, (rx, ry) => {
    const p = d4MapPoint(op, rx * w, ry * h, w, h);
    return { x: p.x / p.w, y: p.y / p.h };
  });
}

/** 任意仿射下的 landmarks 重映射（m 为源→目标矩阵，目标原点在 (minX,minY)）。 */
export function affineTransformLandmarks(
  lm: SpriteLandmarks,
  m: Affine2D,
  minX: number,
  minY: number,
  newW: number,
  newH: number,
  oldW: number,
  oldH: number,
): SpriteLandmarks {
  return remapLandmarks(lm, (rx, ry) => {
    const p = applyAffine(m, rx * oldW, ry * oldH);
    return { x: (p.x - minX) / newW, y: (p.y - minY) / newH };
  });
}

/**
 * 绕 (px,py) 的旋转矩阵，与 Canvas ctx.rotate 同约定
 * （Y 向下，正角为视觉顺时针——与主渲染节点角同向）。
 */
export function rotationMatrixAbout(angleDeg: number, px: number, py: number): Affine2D {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = cos;
  const b = sin;
  const c = -sin;
  const d = cos;
  return { a, b, c, d, e: px - (a * px + c * py), f: py - (b * px + d * py) };
}

/**
 * 绕 (px,py)、轴向角 axisDeg 的镜像（反射）矩阵。
 * 轴向 0° = 水平轴（效果同上下镜像），90° = 竖直轴（同左右镜像），
 * 45° = 主对角。反射矩阵 = [[cos2φ, sin2φ], [sin2φ, −cos2φ]]。
 */
export function mirrorAxisMatrixAbout(axisDeg: number, px: number, py: number): Affine2D {
  const rad2 = (2 * axisDeg * Math.PI) / 180;
  const a = Math.cos(rad2);
  const b = Math.sin(rad2);
  const c = Math.sin(rad2);
  const d = -Math.cos(rad2);
  return { a, b, c, d, e: px - (a * px + c * py), f: py - (b * px + d * py) };
}

/** 旋转角路由：90° 倍数落 D4（0° 为恒等），其余返回 null（走仿射烘焙）。 */
export function classifyRotate(angleDeg: number): D4Op | 'identity' | null {
  const n = ((angleDeg % 360) + 360) % 360;
  const r = Math.round(n);
  if (Math.abs(n - r) > 1e-6) return null;
  switch (r % 360) {
    case 0: return 'identity';
    case 90: return 'rot90';
    case 180: return 'rot180';
    case 270: return 'rot270';
    default: return null;
  }
}

/** 镜像轴路由：45° 倍数落 D4，其余返回 null（走仿射烘焙）。 */
export function classifyMirrorAxis(axisDeg: number): D4Op | null {
  const n = ((axisDeg % 180) + 180) % 180;
  const r = Math.round(n);
  if (Math.abs(n - r) > 1e-6) return null;
  switch (r % 180) {
    case 0: return 'flipV';
    case 45: return 'transpose';
    case 90: return 'flipH';
    case 135: return 'antiTranspose';
    default: return null;
  }
}

/**
 * 数值网格（heightmap）的仿射重采样：最近邻、逆映射，
 * 与像素烘焙同一几何（目标像素中心 → 源连续坐标 → 最近源像素）。
 * m 不可逆时返回 null。
 */
export function resampleGridAffine(
  src: number[][],
  m: Affine2D,
  minX: number,
  minY: number,
  outW: number,
  outH: number,
  fill = 0,
): number[][] | null {
  const inv = invertAffine(m);
  if (!inv) return null;
  const srcH = src.length;
  const srcW = src[0]?.length ?? 0;
  const out: number[][] = [];
  for (let j = 0; j < outH; j++) {
    const row: number[] = [];
    for (let i = 0; i < outW; i++) {
      const p = applyAffine(inv, minX + i + 0.5, minY + j + 0.5);
      const sx = Math.floor(p.x);
      const sy = Math.floor(p.y);
      row.push(sy >= 0 && sy < srcH && sx >= 0 && sx < srcW ? src[sy]![sx]! : fill);
    }
    out.push(row);
  }
  return out;
}
