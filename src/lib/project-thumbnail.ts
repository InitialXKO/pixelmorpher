// ============================================================
// 项目缩略图生产者（审计域1 E4：ProjectMeta.thumbnail 此前全部写点
// 都是空串、全仓无任何生成者，主页渲染分支永远走不到）。
// PixelCanvas 挂载时把主离屏画布（原生画布尺寸的当前帧合成结果，
// 不含缩放/平移/覆盖层）注册为抓图源；asset-store 在保存工程
// （updateCurrentProjectMeta）时经此抓一张小图写入 meta。
// 编辑器未挂载（主页直接触发保存等）时抓不到 → 返回 ''，调用方
// 回落保留旧缩略图，不覆盖为空。
// ============================================================

type ThumbnailSource = () => HTMLCanvasElement | null;

let source: ThumbnailSource | null = null;

/** 注册抓图源（PixelCanvas 挂载时调用）；返回注销函数 */
export function registerProjectThumbnailSource(fn: ThumbnailSource): () => void {
  source = fn;
  return () => {
    if (source === fn) source = null;
  };
}

/** 抓当前帧缩略图（等比缩到 maxWidth 内）；无源/抓取失败返回 '' */
export function captureProjectThumbnail(maxWidth = 192): string {
  try {
    const src = source?.();
    if (!src || src.width === 0 || src.height === 0) return '';
    const scale = Math.min(1, maxWidth / src.width);
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(src, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
