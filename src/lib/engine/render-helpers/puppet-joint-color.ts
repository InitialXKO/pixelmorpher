/**
 * 关节盘颜色采样：取子节点精灵在关节开口处的众数颜色。
 *
 * 用法：`plug.discColor ?? sampleJointDiscColor(...) ?? fallback`
 */

// ============================================================
// 默认精灵关节约定（CONVENTION）
// ------------------------------------------------------------
// 1. 轮廓开口：肢体连接处（plug / socket 对应的精灵像素）轮廓留开口，
//    开口宽度 = 对应 crossSection 值（plug 侧用 crossSectionTop，socket 侧用子节点 crossSectionTop）。
//    用 carveJointOpening() 在默认精灵生成时 carve。
// 2. 颜色：关节盘颜色可在 plug.discColor 逐关节自定义，不限于预设枚举；
//    为空时自动取子节点侧精灵开口处的众数颜色（排除轮廓色）。
// 3. z-order：关节盘绘制在父子两侧精灵之后，透过开口可见（unified: discZ = min(parentZ, childZ) - 50；
//    旧管线: renderJointDiscs 在精灵绘制之前调用）。
// 4. 大小：关节盘直径 = 两侧开口宽度的平均值
//    = (parent.crossSectionBottom + child.crossSectionTop) / 2。
// ============================================================ */

import type { PixelGrid } from '../../types';

/** 默认精灵的轮廓色（采样时排除，避免关节盘取成描边色） */
export const DEFAULT_OUTLINE_COLOR = '#1a1a2e';

/**
 * 在开口中心 (cx, cy) 附近采样众数颜色。
 * 只统计不透明像素并排除轮廓色；若无有效像素返回 null（调用方再 fallback）。
 */
export function sampleJointDiscColor(
  pixels: PixelGrid,
  cx: number,
  cy: number,
  outlineColor: string = DEFAULT_OUTLINE_COLOR,
): string | null {
  const h = pixels.length;
  if (h === 0) return null;
  const w = pixels[0]?.length ?? 0;
  if (w === 0) return null;

  const outline = outlineColor.toLowerCase();
  const counts = new Map<string, number>();
  const R = 3; // 采样半径（切比雪夫距离）

  for (let y = Math.max(0, Math.floor(cy) - R); y <= Math.min(h - 1, Math.ceil(cy) + R); y++) {
    const row = pixels[y];
    if (!row) continue;
    for (let x = Math.max(0, Math.floor(cx) - R); x <= Math.min(w - 1, Math.ceil(cx) + R); x++) {
      const c = row[x];
      if (!c) continue; // 透明跳过
      const key = c.toLowerCase();
      if (key === outline) continue; // 排除轮廓色
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [color, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = color;
    }
  }
  return best;
}

/**
 * 对一组关节开口批量 carve（原地修改，调用方应传入可写的像素网格）。
 */
export interface JointOpeningSpec {
  x: number;
  y: number;
  width: number;
}

export function applyJointOpenings(
  pixels: PixelGrid,
  openings: JointOpeningSpec[],
  outlineColor: string = DEFAULT_OUTLINE_COLOR,
): void {
  for (const o of openings) {
    carveJointOpening(pixels, o.x, o.y, o.width, outlineColor);
  }
}

/** 计算 plug 侧关节开口宽度所需的最精简节点/精灵信息 */
export interface PlugJointWidthInput {
  plug?: { localX: number; localY: number; jointWidth?: number | null } | null;
  crossSectionTop?: number | null;
  crossSectionBottom?: number | null;
}

export interface PlugJointWidthSprite {
  width: number;
  height: number;
  pivotX: number;
  pivotY: number;
}

/**
 * 计算关节开口宽度（= 关节盘直径）。
 * 规则：plug.jointWidth（创建时写入）> 按 plug 在精灵上的上下位置取 crossSectionTop/Bottom > 4。
 *
 * 注意：不再与 parent.crossSectionBottom 求平均——parent 的 bottom（如躯干的髋宽）
 * 与当前 socket（如肩）无关，求平均会让关节盘比开口大一圈。
 */
export function getPlugJointWidth(
  node: PlugJointWidthInput,
  sprite?: PlugJointWidthSprite | null,
): number {
  const stored = node.plug?.jointWidth;
  if (typeof stored === 'number' && stored > 0) return stored;
  if (node.plug && sprite && sprite.height > 0) {
    const plugY = sprite.pivotY + node.plug.localY;
    const w = plugY >= sprite.height / 2 ? node.crossSectionBottom : node.crossSectionTop;
    if (typeof w === 'number' && w > 0) return w;
  }
  return 4;
}

/**
 * 在精灵轮廓上为关节连接处 carve 一个开口（notch）。
 * 只清除轮廓色的像素，不动填充色；若该处没有轮廓像素则无操作。
 * 开口方向按最近边缘自动判定：顶部/底部 → 横向槽；左侧/右侧 → 纵向槽。
 *
 * @param pixels 精灵像素（会被原地修改，调用方应先拷贝）
 * @param cx, cy 关节中心（精灵像素坐标）
 * @param width 开口宽度（= 对应 crossSection 值）
 * @param outlineColor 轮廓色
 */
export function carveJointOpening(
  pixels: PixelGrid,
  cx: number,
  cy: number,
  width: number,
  outlineColor: string = DEFAULT_OUTLINE_COLOR,
): void {
  const h = pixels.length;
  if (h === 0) return;
  const w = pixels[0]?.length ?? 0;
  if (w === 0 || width <= 0) return;

  const outline = outlineColor.toLowerCase();
  // 按最近边缘决定开口方向：顶部/底部 → 横向槽；左侧/右侧 → 纵向槽
  const dTop = cy;
  const dBottom = h - 1 - cy;
  const dLeft = cx;
  const dRight = w - 1 - cx;
  const minD = Math.min(dTop, dBottom, dLeft, dRight);
  const horizontal = minD === dTop || minD === dBottom;

  const half = width / 2;
  const clearIfOutline = (x: number, y: number) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
    const row = pixels[iy];
    const c = row?.[ix];
    if (c && c.toLowerCase() === outline) {
      row[ix] = null;
    }
  };

  if (horizontal) {
    const iy = Math.round(cy);
    for (let x = Math.ceil(cx - half); x < cx + half; x++) clearIfOutline(x, iy);
  } else {
    const ix = Math.round(cx);
    for (let y = Math.ceil(cy - half); y < cy + half; y++) clearIfOutline(ix, y);
  }
}
