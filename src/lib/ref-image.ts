// 参考图（垫图）共用绘制口径：主画布、草图捕姿、画火柴人三处共用
// 同一份几何定义，不许各处再抄一份近似换算。
//
// 坐标口径：参考图活在「工程画布帧」里——主画布的离屏帧就是工程
// 画布尺寸（canvasWidth × canvasHeight），参考图在帧内 contain 居中
// 绘制，角色的世界渲染（原点 = 帧中心）叠在它之上，整帧再按 pan/zoom
// 贴到屏幕。所以参考图与骨架的相对位置只由工程画布帧决定，与显示
// 尺寸/缩放无关。
//
// 其他窗口要同坐标，充要条件是与工程画布帧共用同一世界坐标系：
// 同原点（帧中心）、同比例（1:1 px）。窗口尺寸与工程画布不同时，
// 矩形只需按中心差平移（refImageRectForWindow）， dw/dh 不变——
// 差异只来自窗口的可视范围，不来自坐标系。

export interface RefImageRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** 参考图在 frameW × frameH 画布帧内的 contain 居中矩形（主画布口径）。 */
export function refImageRect(
  frameW: number, frameH: number, imgW: number, imgH: number,
): RefImageRect {
  const scale = Math.min(frameW / imgW, frameH / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  return { dx: (frameW - dw) / 2, dy: (frameH - dh) / 2, dw, dh };
}

/**
 * 中心对齐窗口（winW × winH）内的参考图矩形：窗口与工程画布帧同
 * 原点（各自中心重合）、同比例时，主画布矩形按中心差平移即得。
 * 草图捕姿窗口尺寸 == 工程画布，平移为 0，与主画布逐像素一致；
 * 画火柴人窗口是固定尺寸的中心窗口，平移 = (窗口 − 工程画布)/2。
 */
export function refImageRectForWindow(
  frameW: number, frameH: number, imgW: number, imgH: number,
  winW: number, winH: number,
): RefImageRect {
  const r = refImageRect(frameW, frameH, imgW, imgH);
  return {
    dx: r.dx + (winW - frameW) / 2,
    dy: r.dy + (winH - frameH) / 2,
    dw: r.dw,
    dh: r.dh,
  };
}

/** 参考图上归一化点 (u, v) 在给定矩形内的像素位（探针/对位用）。 */
export function refImagePoint(rect: RefImageRect, u: number, v: number): { x: number; y: number } {
  return { x: rect.dx + u * rect.dw, y: rect.dy + v * rect.dh };
}

/** 按主画布同款样式绘制参考图：不透明度 + 关闭平滑（像素口径）。 */
export function drawRefImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: RefImageRect,
  opacity: number,
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, rect.dx, rect.dy, rect.dw, rect.dh);
  ctx.restore();
}

export function refImageReady(img: HTMLImageElement | null | undefined): boolean {
  return !!img && img.complete && img.naturalWidth > 0;
}

// ---- 图片加载缓存（按 URL 一份，多窗口共用；加载完成通知全部订阅者） ----
const cache = new Map<string, { img: HTMLImageElement; listeners: Set<() => void> }>();

export function loadRefImage(url: string, onLoad?: () => void): HTMLImageElement {
  let entry = cache.get(url);
  if (!entry) {
    const img = new Image();
    img.src = url;
    entry = { img, listeners: new Set() };
    cache.set(url, entry);
    img.onload = () => {
      const listeners = [...entry!.listeners];
      entry!.listeners.clear();
      for (const fn of listeners) fn();
    };
  }
  if (onLoad && !refImageReady(entry.img)) entry.listeners.add(onLoad);
  return entry.img;
}
