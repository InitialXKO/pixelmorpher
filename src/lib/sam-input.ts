// ============================================================
// sam-input — SAM 提取的输入侧几何（纯函数，可探针）
// ============================================================
// 设计（2026-10-23 用户拍板，甲案）：防溢出线决定 SAM 的输入范围——
// 线外区域根本不输入 SAM。以正点（视点）为原点，凡与视点的连线被线
// 穿过的像素即「线外」：构建输入图时把这些像素（及线本身）涂成底色，
// 再送 SAM 编码。SAM 看不到线外，自然无从漏过去；约束在预测之前、
// 输入一侧，不对返回位图做任何后处理。
//
// 「不重算输入」：输入只依赖（参考图，线版本，视点）。同一次提取里
// 增删正/负点只重跑解码，输入与编码不动；线一改或视点一换才重建。
//
// 坐标：阴影在原图自然像素空间计算（输入图即原图尺寸，SAM 的归一
// 化提示坐标与原图一致）；编辑器画布与原图之间走 contain 映射。

export interface Pt {
  x: number;
  y: number;
}

export interface ContainFit {
  /** 画布 px / 原图 px */
  scale: number;
  /** 原图绘制矩形在画布中的左上角 */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export function containFit(iw: number, ih: number, cw: number, ch: number): ContainFit {
  const scale = Math.min(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  return { scale, dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

/** 画布坐标 → 原图坐标；落在原图绘制矩形外返回 null */
export function canvasToImage(fit: ContainFit, cx: number, cy: number): Pt | null {
  const x = (cx - fit.dx) / fit.scale;
  const y = (cy - fit.dy) / fit.scale;
  if (x < 0 || y < 0) return null;
  const iw = fit.dw / fit.scale;
  const ih = fit.dh / fit.scale;
  if (x >= iw || y >= ih) return null;
  return { x, y };
}

/** 画布坐标 → 原图坐标，钳制进原图边界（线的端点可画在图外，映射后仍要有落点） */
export function canvasToImageClamped(fit: ContainFit, iw: number, ih: number, cx: number, cy: number): Pt {
  const x = (cx - fit.dx) / fit.scale;
  const y = (cy - fit.dy) / fit.scale;
  return {
    x: Math.min(iw - 1, Math.max(0, x)),
    y: Math.min(ih - 1, Math.max(0, y)),
  };
}

/** 原图坐标 → 画布坐标 */
export function imageToCanvas(fit: ContainFit, ix: number, iy: number): Pt {
  return { x: ix * fit.scale + fit.dx, y: iy * fit.scale + fit.dy };
}

/**
 * 一条线段从视点投下的阴影四边形：[a, b, bExt, aExt]，其中 aExt/bExt 是
 * a/b 沿「视点→该端点」方向延长 reach 后的点。视线被线段挡住的像素恰
 * 落在这些四边形的并集里（线外）；从线段端点外侧绕过去的像素不在其
 * 中——开放线段绕端合法，与栅栏语义一致。端点与视点重合的退化段跳过。
 */
export function shadowQuad(view: Pt, a: Pt, b: Pt, reach: number): [Pt, Pt, Pt, Pt] | null {
  const ext = (p: Pt): Pt | null => {
    const dx = p.x - view.x;
    const dy = p.y - view.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    return { x: p.x + (dx / len) * reach, y: p.y + (dy / len) * reach };
  };
  const aExt = ext(a);
  const bExt = ext(b);
  if (!aExt || !bExt) return null;
  return [a, b, bExt, aExt];
}

/** 一条折线（≥2 点）的全部阴影四边形 */
export function shadowQuadsForPolyline(view: Pt, line: Pt[], reach: number): [Pt, Pt, Pt, Pt][] {
  const out: [Pt, Pt, Pt, Pt][] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const q = shadowQuad(view, line[i]!, line[i + 1]!, reach);
    if (q) out.push(q);
  }
  return out;
}

/** 射线法点在多边形内（探针与判定共用；边界情况不保证） */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x, yi = poly[i]!.y;
    const xj = poly[j]!.x, yj = poly[j]!.y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
