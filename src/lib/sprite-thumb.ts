/**
 * sprite-thumb.ts — 精灵缩略图：等比适配 + 按对象身份缓存
 * （research/sprite-management 纵切）
 *
 * 背景（盘点实锤）：DressPanel 的本地 SpriteThumbnail 每次
 * 挂载逐像素 fillRect 重画、无缓存，CSS 又把画布拉成正方
 * 形——非正方形精灵会变形；精灵上百张时选择器一开就是
 * 数十万次 fillRect。这里收拢为全仓一份：
 *
 * - thumbFitRect：精灵在方框内等比适配、居中（不变形）。
 * - getSpriteThumbCanvas：把 PixelGrid 栅格化到离屏画布
 *   一次，按精灵对象身份 WeakMap 缓存——store 的不可变
 *   更新换对象即自然失效，旧条目随对象被回收。缓存画布
 *   边长封顶 THUMB_MAX（大精灵先降采样，省内存）。
 * - filterSpritesByQuery：名字子串过滤（大小写不敏感，
 *   空查询返回全部），列表与选择器共用。
 */
import type { Sprite } from './unified-types';

/** 缓存画布的最长边（px）：缩略图显示尺寸远小于此 */
export const THUMB_MAX = 96;

/** 精灵在 box×box 方框内的等比适配矩形（居中、整数像素） */
export function thumbFitRect(
  w: number, h: number, box: number,
): { x: number; y: number; w: number; h: number } {
  if (w <= 0 || h <= 0 || box <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(box / w, box / h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  return { x: Math.floor((box - dw) / 2), y: Math.floor((box - dh) / 2), w: dw, h: dh };
}

const thumbCache = new WeakMap<object, HTMLCanvasElement>();

/**
 * 取精灵的缩略图离屏画布（首次构建、之后缓存）。
 * 无 DOM 环境（探针/SSR）返回 null。
 */
export function getSpriteThumbCanvas(sprite: Sprite): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const hit = thumbCache.get(sprite);
  if (hit) return hit;
  const w = sprite.width, h = sprite.height;
  if (!w || !h || !sprite.data) return null;
  // 先在原生尺寸栅格化，再按需降采样到封顶尺寸
  const native = document.createElement('canvas');
  native.width = w;
  native.height = h;
  const nctx = native.getContext('2d');
  if (!nctx) return null;
  for (let y = 0; y < h; y++) {
    const row = sprite.data[y];
    if (!row) continue;
    for (let x = 0; x < w; x++) {
      const c = row[x];
      if (c && c !== '#00000000' && !c.endsWith('00')) {
        nctx.fillStyle = c;
        nctx.fillRect(x, y, 1, 1);
      }
    }
  }
  let out = native;
  if (Math.max(w, h) > THUMB_MAX) {
    const fit = thumbFitRect(w, h, THUMB_MAX);
    out = document.createElement('canvas');
    out.width = fit.w;
    out.height = fit.h;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.imageSmoothingEnabled = false;
    octx.drawImage(native, 0, 0, fit.w, fit.h);
  }
  thumbCache.set(sprite, out);
  return out;
}

/** 名字过滤：子串、大小写不敏感；空/纯空白查询返回原数组 */
export function filterSpritesByQuery<T extends { name?: string }>(
  sprites: readonly T[], query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sprites];
  return sprites.filter((s) => (s.name ?? '').toLowerCase().includes(q));
}
